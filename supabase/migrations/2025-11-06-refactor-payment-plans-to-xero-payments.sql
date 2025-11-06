-- Refactor Payment Plans to use xero_payments
-- Consolidates payment plan logic into xero_payments table instead of separate tables
-- This makes payment plans consistent with regular payments and simplifies architecture

-- 1. Add payment plan columns to xero_payments
ALTER TABLE xero_payments
ADD COLUMN IF NOT EXISTS payment_type TEXT CHECK (payment_type IN ('full', 'installment')),
ADD COLUMN IF NOT EXISTS installment_number INTEGER,
ADD COLUMN IF NOT EXISTS planned_payment_date DATE,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Set default payment_type for existing records
UPDATE xero_payments
SET payment_type = 'full'
WHERE payment_type IS NULL;

-- Make payment_type NOT NULL after setting defaults
ALTER TABLE xero_payments
ALTER COLUMN payment_type SET NOT NULL;

-- 2. Add is_payment_plan flag to xero_invoices
ALTER TABLE xero_invoices
ADD COLUMN IF NOT EXISTS is_payment_plan BOOLEAN DEFAULT FALSE;

-- 3. Update sync_status to include 'planned' status for future installments
-- First, check if there are any invalid sync_status values and log them
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM xero_payments
  WHERE sync_status NOT IN ('pending', 'staged', 'processing', 'synced', 'failed', 'ignore');

  IF invalid_count > 0 THEN
    RAISE NOTICE 'Found % rows with invalid sync_status values', invalid_count;

    -- Update any invalid values to 'failed' so we can add the constraint
    UPDATE xero_payments
    SET sync_status = 'failed'
    WHERE sync_status NOT IN ('pending', 'staged', 'processing', 'synced', 'failed', 'ignore');

    RAISE NOTICE 'Updated invalid sync_status values to failed';
  END IF;
END $$;

-- Now drop and recreate the constraint with 'planned' added
ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments
ADD CONSTRAINT xero_payments_sync_status_check
CHECK (sync_status IN ('pending', 'staged', 'planned', 'processing', 'synced', 'failed', 'ignore'));

-- Update comment
COMMENT ON COLUMN xero_payments.sync_status IS 'pending=ready for sync, staged=created but not ready, planned=future installment (internal only), processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required)';

-- 4. Create indexes for efficient payment plan queries
CREATE INDEX IF NOT EXISTS idx_xero_payments_planned_ready
ON xero_payments(sync_status, planned_payment_date)
WHERE sync_status = 'planned' AND planned_payment_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_xero_payments_payment_type
ON xero_payments(payment_type);

CREATE INDEX IF NOT EXISTS idx_xero_payments_invoice_installment
ON xero_payments(xero_invoice_id, installment_number)
WHERE installment_number IS NOT NULL;

-- 5. Create view for payment plan summary (replaces direct queries to payment_plans table)
-- Using SECURITY INVOKER so it respects the caller's permissions
CREATE OR REPLACE VIEW payment_plan_summary
WITH (security_invoker = true)
AS
SELECT
  xi.id as invoice_id,
  (xi.staging_metadata->>'user_id')::uuid as contact_id,
  xi.payment_id as first_payment_id,
  COUNT(*) FILTER (WHERE xp.payment_type = 'installment') as total_installments,
  SUM(xp.amount_paid) FILTER (WHERE xp.sync_status IN ('synced','pending','processing')) as paid_amount,
  SUM(xp.amount_paid) as total_amount,
  MAX(xp.planned_payment_date) as final_payment_date,
  MIN(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned') as next_payment_date,
  COUNT(*) FILTER (WHERE xp.sync_status IN ('synced','pending','processing') AND xp.payment_type = 'installment') as installments_paid,
  CASE
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'planned') = 0 THEN 'completed'
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'failed') > 0 THEN 'failed'
    ELSE 'active'
  END as status,
  json_agg(
    json_build_object(
      'id', xp.id,
      'installment_number', xp.installment_number,
      'amount', xp.amount_paid,
      'planned_payment_date', xp.planned_payment_date,
      'sync_status', xp.sync_status,
      'attempt_count', xp.attempt_count,
      'failure_reason', xp.failure_reason
    ) ORDER BY xp.installment_number
  ) as installments
FROM xero_invoices xi
JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
WHERE xi.is_payment_plan = true
GROUP BY xi.id, xi.staging_metadata, xi.payment_id;

-- Restrict access to admin users only via RLS on the view
ALTER VIEW payment_plan_summary SET (security_barrier = true);

-- Revoke public access
REVOKE ALL ON payment_plan_summary FROM PUBLIC;
REVOKE ALL ON payment_plan_summary FROM anon;
REVOKE ALL ON payment_plan_summary FROM authenticated;

-- Grant access only to service_role (used by admin APIs with createAdminClient)
GRANT SELECT ON payment_plan_summary TO service_role;

-- 6. Drop old payment plan tables
-- Skipping data migration since this is development environment
DROP TABLE IF EXISTS payment_plan_transactions CASCADE;
DROP TABLE IF EXISTS payment_plans CASCADE;

-- 7. Add helpful comments
COMMENT ON COLUMN xero_payments.payment_type IS 'Type of payment: full (single payment) or installment (part of payment plan)';
COMMENT ON COLUMN xero_payments.installment_number IS 'Which installment this is (1-4) for payment plans, NULL for full payments';
COMMENT ON COLUMN xero_payments.planned_payment_date IS 'When this installment is scheduled to be charged (for planned status only)';
COMMENT ON COLUMN xero_payments.attempt_count IS 'Number of charge attempts made for this installment (max 3 attempts)';
COMMENT ON COLUMN xero_payments.last_attempt_at IS 'Timestamp of last charge attempt';
COMMENT ON COLUMN xero_payments.failure_reason IS 'Reason payment charge failed (for troubleshooting)';
COMMENT ON COLUMN xero_invoices.is_payment_plan IS 'Whether this invoice is for a payment plan (multiple installments)';
COMMENT ON VIEW payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments';
