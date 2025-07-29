-- Add 'processing' status to Xero tables for database-level locking
-- This prevents race conditions by allowing records to be marked as "processing"
-- while they are being synced to Xero

-- Update xero_invoices sync_status check constraint
ALTER TABLE xero_invoices 
DROP CONSTRAINT IF EXISTS xero_invoices_sync_status_check;

ALTER TABLE xero_invoices 
ADD CONSTRAINT xero_invoices_sync_status_check 
CHECK (sync_status IN ('pending', 'staged', 'processing', 'synced', 'failed', 'ignore'));

-- Update xero_payments sync_status check constraint  
ALTER TABLE xero_payments 
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments 
ADD CONSTRAINT xero_payments_sync_status_check 
CHECK (sync_status IN ('pending', 'staged', 'processing', 'synced', 'failed', 'ignore'));

-- Add comments explaining the new status
COMMENT ON COLUMN xero_invoices.sync_status IS 'pending=ready for sync, staged=created but not ready, processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required)';
COMMENT ON COLUMN xero_payments.sync_status IS 'pending=ready for sync, staged=created but not ready, processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required)';

-- Create database functions for proper row-level locking
-- These functions use SELECT FOR UPDATE to lock records and mark them as processing
-- This prevents race conditions where the same record could be processed multiple times

-- Function to get pending invoices with proper locking
CREATE OR REPLACE FUNCTION get_pending_xero_invoices_with_lock(limit_count INTEGER DEFAULT 50)
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
  line_items JSONB
) 
LANGUAGE plpgsql
AS $$
BEGIN
  -- Use a transaction with SELECT FOR UPDATE to lock records
  -- This prevents other processes from accessing the same records
  RETURN QUERY
  WITH locked_invoices AS (
    SELECT 
      xi.*,
      json_agg(xili.*) FILTER (WHERE xili.id IS NOT NULL) as line_items
    FROM xero_invoices xi
    LEFT JOIN xero_invoice_line_items xili ON xi.id = xili.xero_invoice_id
    WHERE xi.sync_status = 'pending'
    GROUP BY xi.id, xi.payment_id, xi.tenant_id, xi.xero_invoice_id, xi.invoice_number, 
             xi.invoice_type, xi.invoice_status, xi.total_amount, xi.discount_amount, 
             xi.net_amount, xi.stripe_fee_amount, xi.sync_status, xi.last_synced_at, 
             xi.sync_error, xi.staged_at, xi.staging_metadata, xi.created_at, xi.updated_at
    ORDER BY xi.staged_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  ),
  updated_invoices AS (
    UPDATE xero_invoices 
    SET 
      sync_status = 'processing',
      updated_at = NOW()
    WHERE id IN (SELECT id FROM locked_invoices)
  )
  SELECT 
    li.id,
    li.payment_id,
    li.tenant_id,
    li.xero_invoice_id,
    li.invoice_number,
    li.invoice_type,
    li.invoice_status,
    li.total_amount,
    li.discount_amount,
    li.net_amount,
    li.stripe_fee_amount,
    li.sync_status,
    li.last_synced_at,
    li.sync_error,
    li.staged_at,
    li.staging_metadata,
    li.created_at,
    li.updated_at,
    li.line_items
  FROM locked_invoices li;
END;
$$;

-- Function to get pending payments with proper locking
CREATE OR REPLACE FUNCTION get_pending_xero_payments_with_lock(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  xero_invoice_id UUID,
  tenant_id TEXT,
  xero_payment_id UUID,
  payment_method TEXT,
  bank_account_code TEXT,
  amount_paid INTEGER,
  stripe_fee_amount INTEGER,
  reference TEXT,
  sync_status TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_error TEXT,
  staged_at TIMESTAMP WITH TIME ZONE,
  staging_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) 
LANGUAGE plpgsql
AS $$
BEGIN
  -- Use a transaction with SELECT FOR UPDATE to lock records
  -- This prevents other processes from accessing the same records
  RETURN QUERY
  WITH locked_payments AS (
    SELECT xp.*
    FROM xero_payments xp
    WHERE xp.sync_status = 'pending'
    ORDER BY xp.staged_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  ),
  updated_payments AS (
    UPDATE xero_payments 
    SET 
      sync_status = 'processing',
      updated_at = NOW()
    WHERE id IN (SELECT id FROM locked_payments)
  )
  SELECT 
    lp.id,
    lp.xero_invoice_id,
    lp.tenant_id,
    lp.xero_payment_id,
    lp.payment_method,
    lp.bank_account_code,
    lp.amount_paid,
    lp.stripe_fee_amount,
    lp.reference,
    lp.sync_status,
    lp.last_synced_at,
    lp.sync_error,
    lp.staged_at,
    lp.staging_metadata,
    lp.created_at,
    lp.updated_at
  FROM locked_payments lp;
END;
$$;

-- Add comments to the functions
COMMENT ON FUNCTION get_pending_xero_invoices_with_lock(INTEGER) IS 'Gets pending invoices with row-level locking using SELECT FOR UPDATE. Marks records as processing to prevent race conditions.';
COMMENT ON FUNCTION get_pending_xero_payments_with_lock(INTEGER) IS 'Gets pending payments with row-level locking using SELECT FOR UPDATE. Marks records as processing to prevent race conditions.'; 