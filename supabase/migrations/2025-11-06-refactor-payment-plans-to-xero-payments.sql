-- Refactor Payment Plans to use xero_payments
-- Consolidates payment plan logic into xero_payments table instead of separate tables
-- This makes payment plans consistent with regular payments and simplifies architecture

-- 1. Add payment plan columns to xero_payments
ALTER TABLE xero_payments
ADD COLUMN IF NOT EXISTS payment_type TEXT CHECK (payment_type IN ('full', 'installment')),
ADD COLUMN IF NOT EXISTS installment_number INTEGER,
ADD COLUMN IF NOT EXISTS planned_payment_date DATE,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3,
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
CREATE OR REPLACE VIEW payment_plan_summary AS
SELECT
  xi.id as invoice_id,
  xi.contact_id,
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
GROUP BY xi.id, xi.contact_id, xi.payment_id;

-- 6. Migrate existing payment_plan_transactions data to xero_payments
-- This preserves any existing payment plan data before dropping old tables
DO $$
DECLARE
  transaction_record RECORD;
  plan_record RECORD;
  invoice_id UUID;
  tenant_id_val TEXT;
BEGIN
  -- Only run if the old tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_plan_transactions') THEN

    -- Get the active tenant_id (assuming single tenant for now)
    SELECT tenant_id INTO tenant_id_val
    FROM xero_oauth_tokens
    WHERE is_active = true
    LIMIT 1;

    IF tenant_id_val IS NULL THEN
      RAISE NOTICE 'No active Xero tenant found - skipping data migration';
      RETURN;
    END IF;

    -- Loop through all payment plan transactions
    FOR transaction_record IN
      SELECT ppt.*, pp.xero_invoice_id, pp.user_id
      FROM payment_plan_transactions ppt
      JOIN payment_plans pp ON ppt.payment_plan_id = pp.id
      ORDER BY pp.id, ppt.installment_number
    LOOP
      -- Map transaction status to xero_payments sync_status
      -- completed/processing → pending (ready to sync to Xero)
      -- pending/failed → planned (not yet charged, internal scheduling)
      INSERT INTO xero_payments (
        xero_invoice_id,
        tenant_id,
        xero_payment_id, -- Will be generated, use placeholder
        payment_method,
        amount_paid,
        reference,
        sync_status,
        payment_type,
        installment_number,
        planned_payment_date,
        attempt_count,
        max_attempts,
        last_attempt_at,
        failure_reason,
        staged_at,
        staging_metadata,
        created_at,
        updated_at
      ) VALUES (
        transaction_record.xero_invoice_id,
        tenant_id_val,
        gen_random_uuid(), -- Placeholder, will be replaced when synced
        'stripe',
        transaction_record.amount,
        CASE
          WHEN transaction_record.stripe_payment_intent_id IS NOT NULL
          THEN 'PI:' || transaction_record.stripe_payment_intent_id
          ELSE NULL
        END,
        CASE transaction_record.status
          WHEN 'completed' THEN 'pending'::TEXT
          WHEN 'processing' THEN 'pending'::TEXT
          WHEN 'pending' THEN 'planned'::TEXT
          WHEN 'failed' THEN 'planned'::TEXT
          ELSE 'planned'::TEXT
        END,
        'installment',
        transaction_record.installment_number,
        transaction_record.scheduled_date,
        transaction_record.attempt_count,
        transaction_record.max_attempts,
        transaction_record.last_attempt_at,
        transaction_record.failure_reason,
        NOW(),
        jsonb_build_object(
          'migrated_from_payment_plan_transactions', true,
          'original_transaction_id', transaction_record.id,
          'payment_plan_id', transaction_record.payment_plan_id,
          'stripe_payment_intent_id', transaction_record.stripe_payment_intent_id
        ),
        transaction_record.created_at,
        transaction_record.updated_at
      )
      ON CONFLICT DO NOTHING; -- Skip if already exists

    END LOOP;

    -- Mark migrated invoices as payment plans
    UPDATE xero_invoices xi
    SET is_payment_plan = true
    WHERE EXISTS (
      SELECT 1 FROM payment_plans pp
      WHERE pp.xero_invoice_id = xi.id
    );

    RAISE NOTICE 'Successfully migrated payment plan data to xero_payments';
  END IF;
END $$;

-- 7. Drop old payment plan tables (after migration completes)
-- These are now redundant as all data is in xero_payments
DROP TABLE IF EXISTS payment_plan_transactions CASCADE;
DROP TABLE IF EXISTS payment_plans CASCADE;

-- 8. Add helpful comments
COMMENT ON COLUMN xero_payments.payment_type IS 'Type of payment: full (single payment) or installment (part of payment plan)';
COMMENT ON COLUMN xero_payments.installment_number IS 'Which installment this is (1-4) for payment plans, NULL for full payments';
COMMENT ON COLUMN xero_payments.planned_payment_date IS 'When this installment is scheduled to be charged (for planned status only)';
COMMENT ON COLUMN xero_payments.attempt_count IS 'Number of charge attempts made for this installment';
COMMENT ON COLUMN xero_payments.max_attempts IS 'Maximum retry attempts before marking as failed';
COMMENT ON COLUMN xero_payments.last_attempt_at IS 'Timestamp of last charge attempt';
COMMENT ON COLUMN xero_payments.failure_reason IS 'Reason payment charge failed (for troubleshooting)';
COMMENT ON COLUMN xero_invoices.is_payment_plan IS 'Whether this invoice is for a payment plan (multiple installments)';
COMMENT ON VIEW payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments';
