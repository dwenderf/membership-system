-- Payment Plans Feature Migration
-- Adds support for installment payment plans (4 monthly installments at 25% each)
-- Uses xero_payments table with payment_type='installment' instead of separate tables

-- =============================================
-- 1. USER ELIGIBILITY
-- =============================================

-- Add payment plan eligibility flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_plan_enabled BOOLEAN DEFAULT FALSE;

-- Create partial index for payment plan eligible users (for efficient queries)
CREATE INDEX IF NOT EXISTS idx_users_payment_plan_enabled
ON users(payment_plan_enabled)
WHERE payment_plan_enabled = true;

COMMENT ON COLUMN users.payment_plan_enabled IS 'Admin-controlled flag to enable payment plan option for this user';

-- =============================================
-- 2. USER_REGISTRATIONS DATA INTEGRITY
-- =============================================

-- Remove constraint if it exists (from earlier version of migration)
ALTER TABLE user_registrations
DROP CONSTRAINT IF EXISTS user_registrations_xero_invoice_id_key;

-- Add unique index to enforce one-to-one relationship between user_registrations and xero_invoices
-- Uses partial index to allow multiple NULL values while enforcing uniqueness on non-NULL values
-- This prevents data integrity issues in payment_plan_summary view aggregations
CREATE UNIQUE INDEX IF NOT EXISTS user_registrations_xero_invoice_id_key
  ON user_registrations(xero_invoice_id)
  WHERE xero_invoice_id IS NOT NULL;

-- =============================================
-- 3. XERO_PAYMENTS TABLE UPDATES
-- =============================================

-- Drop UNIQUE constraint that prevents multiple payments per invoice
-- Payment plans need multiple xero_payments records per invoice (one per installment)
ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_xero_invoice_id_tenant_id_key;

-- Add payment plan columns to xero_payments
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

-- Update sync_status to include 'planned' for future installments and 'cancelled' for early payoff
-- First, check if there are any invalid sync_status values and fix them
-- NOTE: Include 'planned' and 'cancelled' in the validation list to avoid marking them as failed
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM xero_payments
  WHERE sync_status NOT IN ('pending', 'staged', 'planned', 'cancelled', 'processing', 'synced', 'failed', 'ignore');

  IF invalid_count > 0 THEN
    RAISE NOTICE 'Found % rows with invalid sync_status values', invalid_count;

    -- Update any invalid values to 'failed' so we can add the constraint
    UPDATE xero_payments
    SET sync_status = 'failed'
    WHERE sync_status NOT IN ('pending', 'staged', 'planned', 'cancelled', 'processing', 'synced', 'failed', 'ignore');

    RAISE NOTICE 'Updated invalid sync_status values to failed';
  END IF;
END $$;

-- Now drop and recreate the constraint with 'planned' and 'cancelled' added
ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments
ADD CONSTRAINT xero_payments_sync_status_check
CHECK (sync_status IN ('pending', 'staged', 'planned', 'cancelled', 'processing', 'synced', 'failed', 'ignore'));

-- Create indexes for efficient payment plan queries
CREATE INDEX IF NOT EXISTS idx_xero_payments_planned_ready
ON xero_payments(sync_status, planned_payment_date)
WHERE sync_status = 'planned' AND planned_payment_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_xero_payments_payment_type
ON xero_payments(payment_type);

CREATE INDEX IF NOT EXISTS idx_xero_payments_invoice_installment
ON xero_payments(xero_invoice_id, installment_number)
WHERE installment_number IS NOT NULL;

-- Comments
COMMENT ON COLUMN xero_payments.payment_type IS 'Type of payment: full (single payment) or installment (part of payment plan)';
COMMENT ON COLUMN xero_payments.installment_number IS 'Which installment this is (1-4) for payment plans, NULL for full payments';
COMMENT ON COLUMN xero_payments.planned_payment_date IS 'When this installment is scheduled to be charged (for planned status only)';
COMMENT ON COLUMN xero_payments.attempt_count IS 'Number of charge attempts made for this installment (max 3 attempts)';
COMMENT ON COLUMN xero_payments.last_attempt_at IS 'Timestamp of last charge attempt';
COMMENT ON COLUMN xero_payments.failure_reason IS 'Reason payment charge failed (for troubleshooting)';
COMMENT ON COLUMN xero_payments.sync_status IS 'pending=ready for sync, staged=created but not ready, planned=future installment (internal only), cancelled=payment cancelled (early payoff superseded), processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required)';

-- =============================================
-- 4. XERO_INVOICES TABLE UPDATES
-- =============================================

-- Add is_payment_plan flag to xero_invoices
ALTER TABLE xero_invoices
ADD COLUMN IF NOT EXISTS is_payment_plan BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN xero_invoices.is_payment_plan IS 'Whether this invoice is for a payment plan (multiple installments)';

-- =============================================
-- 5. PAYMENT_PLAN_SUMMARY VIEW
-- =============================================

-- Create view for payment plan summary
-- Includes registration data to avoid nested queries
-- Uses COALESCE to handle NULL paid_amount
DROP VIEW IF EXISTS payment_plan_summary CASCADE;

CREATE OR REPLACE VIEW payment_plan_summary
WITH (security_invoker = true)
AS
SELECT
  xi.id as invoice_id,
  (xi.staging_metadata->>'user_id')::uuid as contact_id,
  xi.payment_id as first_payment_id,
  COUNT(*) FILTER (WHERE xp.payment_type = 'installment') as total_installments,
  COALESCE(SUM(xp.amount_paid) FILTER (WHERE xp.sync_status IN ('synced','pending','processing')), 0) as paid_amount,
  SUM(xp.amount_paid) as total_amount,
  MAX(xp.planned_payment_date) as final_payment_date,
  MIN(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned') as next_payment_date,
  COUNT(*) FILTER (WHERE xp.sync_status IN ('synced','pending','processing') AND xp.payment_type = 'installment') as installments_paid,
  CASE
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'failed') > 0 THEN 'failed'
    WHEN COUNT(*) FILTER (WHERE xp.sync_status IN ('planned', 'staged')) > 0 THEN 'active'
    ELSE 'completed'
  END as status,
  -- Registration information (from user_registrations via xero_invoice_id)
  ur.registration_id,
  -- Use registration name if available, otherwise fall back to line item description
  -- Line item descriptions for registrations typically contain "Registration: <name>"
  COALESCE(
    r.name,
    -- Extract registration name from first line item description
    -- Remove "Registration: " prefix if present, otherwise use full description
    NULLIF(
      regexp_replace(
        (SELECT description FROM xero_invoice_line_items WHERE xero_invoice_id = xi.id ORDER BY id LIMIT 1),
        '^Registration:\s*',
        ''
      ),
      ''
    )
  ) as registration_name,
  s.name as season_name,
  -- Installment details
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
LEFT JOIN user_registrations ur ON ur.xero_invoice_id = xi.id
LEFT JOIN registrations r ON r.id = ur.registration_id
LEFT JOIN seasons s ON s.id = r.season_id
WHERE xi.is_payment_plan = true
GROUP BY xi.id, xi.staging_metadata, xi.payment_id, ur.registration_id, r.name, s.name;

-- Restrict access to admin users only (service_role)
ALTER VIEW payment_plan_summary SET (security_barrier = true);

-- Revoke public access
REVOKE ALL ON payment_plan_summary FROM PUBLIC;
REVOKE ALL ON payment_plan_summary FROM anon;
REVOKE ALL ON payment_plan_summary FROM authenticated;

-- Grant access only to service_role (used by admin APIs and cron jobs)
GRANT SELECT ON payment_plan_summary TO service_role;

COMMENT ON VIEW payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Includes registration data via user_registrations link, with fallback to invoice line item description for orphaned invoices. Uses COALESCE to handle NULL paid_amount when no payments are synced yet.';

-- =============================================
-- 6. RPC FUNCTION UPDATES
-- =============================================

-- Update get_pending_xero_invoices_with_lock to include is_payment_plan field
-- This allows the sync code to detect payment plans and set correct due dates
DROP FUNCTION IF EXISTS get_pending_xero_invoices_with_lock(integer);

CREATE FUNCTION get_pending_xero_invoices_with_lock(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  payment_id UUID,
  tenant_id TEXT,
  xero_invoice_id UUID,
  invoice_number TEXT,
  invoice_type TEXT,
  invoice_status TEXT,
  total_amount INTEGER,
  discount_amount INTEGER,
  net_amount INTEGER,
  stripe_fee_amount INTEGER,
  sync_status TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_error TEXT,
  staged_at TIMESTAMP WITH TIME ZONE,
  staging_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  is_payment_plan BOOLEAN,  -- Added for payment plan detection
  line_items JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH locked_invoices AS (
    -- First, lock the invoice rows to prevent race conditions
    SELECT id, payment_id, tenant_id, xero_invoice_id, invoice_number,
           invoice_type, invoice_status, total_amount, discount_amount,
           net_amount, stripe_fee_amount, sync_status, last_synced_at,
           sync_error, staged_at, staging_metadata, created_at, updated_at,
           is_payment_plan
    FROM xero_invoices
    WHERE sync_status = 'pending'
    ORDER BY created_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  )
  SELECT
    xi.id,
    xi.payment_id,
    xi.tenant_id,
    xi.xero_invoice_id,
    xi.invoice_number,
    xi.invoice_type,
    xi.invoice_status,
    xi.total_amount,
    xi.discount_amount,
    xi.net_amount,
    xi.stripe_fee_amount,
    xi.sync_status,
    xi.last_synced_at,
    xi.sync_error,
    xi.staged_at,
    xi.staging_metadata,
    xi.created_at,
    xi.updated_at,
    xi.is_payment_plan,  -- Added for payment plan detection
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', xil.id,
          'line_item_type', xil.line_item_type,
          'item_id', xil.item_id,
          'description', xil.description,
          'quantity', xil.quantity,
          'unit_amount', xil.unit_amount,
          'account_code', xil.account_code,
          'tax_type', xil.tax_type,
          'line_amount', xil.line_amount
        )
        ORDER BY xil.created_at
      ) FILTER (WHERE xil.id IS NOT NULL),
      '[]'::jsonb
    ) AS line_items
  FROM locked_invoices xi
  LEFT JOIN xero_invoice_line_items xil ON xi.id = xil.xero_invoice_id
  GROUP BY xi.id, xi.payment_id, xi.tenant_id, xi.xero_invoice_id,
           xi.invoice_number, xi.invoice_type, xi.invoice_status,
           xi.total_amount, xi.discount_amount, xi.net_amount,
           xi.stripe_fee_amount, xi.sync_status, xi.last_synced_at,
           xi.sync_error, xi.staged_at, xi.staging_metadata,
           xi.created_at, xi.updated_at, xi.is_payment_plan
  ORDER BY xi.created_at ASC;
END;
$$;

COMMENT ON FUNCTION get_pending_xero_invoices_with_lock(INTEGER) IS
'Gets pending invoices with row-level locking using SELECT FOR UPDATE. Marks records as processing to prevent race conditions. Includes is_payment_plan field for correct due date calculation.';
