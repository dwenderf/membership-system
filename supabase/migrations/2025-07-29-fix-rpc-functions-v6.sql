-- Fix the RPC functions by casting json_agg to jsonb
-- The issue is that json_agg returns json but we expect jsonb

-- Drop the existing functions
DROP FUNCTION IF EXISTS get_pending_xero_invoices_with_lock(INTEGER);
DROP FUNCTION IF EXISTS get_pending_xero_payments_with_lock(INTEGER);

-- Recreate the invoice function with proper JSON casting
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
DECLARE
  rec RECORD;
BEGIN
  -- Use a cursor to iterate through pending records and lock them
  FOR rec IN 
    SELECT xi.id as invoice_id
    FROM xero_invoices xi
    WHERE xi.sync_status = 'pending'
    ORDER BY xi.staged_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Update each record to processing status
    UPDATE xero_invoices 
    SET 
      sync_status = 'processing',
      updated_at = NOW()
    WHERE xero_invoices.id = rec.invoice_id;
    
    -- Return the record with line items
    RETURN QUERY
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
      (SELECT json_agg(xili.*) FILTER (WHERE xili.id IS NOT NULL)::jsonb
       FROM xero_invoice_line_items xili 
       WHERE xili.xero_invoice_id = xi.id) as line_items
    FROM xero_invoices xi
    WHERE xi.id = rec.invoice_id;
  END LOOP;
END;
$$;

-- Recreate the payment function (no changes needed for this one)
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
DECLARE
  rec RECORD;
BEGIN
  -- Use a cursor to iterate through pending records and lock them
  FOR rec IN 
    SELECT xp.id as payment_id
    FROM xero_payments xp
    WHERE xp.sync_status = 'pending'
    ORDER BY xp.staged_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Update each record to processing status
    UPDATE xero_payments 
    SET 
      sync_status = 'processing',
      updated_at = NOW()
    WHERE xero_payments.id = rec.payment_id;
    
    -- Return the record
    RETURN QUERY
    SELECT 
      xp.id,
      xp.xero_invoice_id,
      xp.tenant_id,
      xp.xero_payment_id,
      xp.payment_method,
      xp.bank_account_code,
      xp.amount_paid,
      xp.stripe_fee_amount,
      xp.reference,
      xp.sync_status,
      xp.last_synced_at,
      xp.sync_error,
      xp.staged_at,
      xp.staging_metadata,
      xp.created_at,
      xp.updated_at
    FROM xero_payments xp
    WHERE xp.id = rec.payment_id;
  END LOOP;
END;
$$;

-- Add comments to the functions
COMMENT ON FUNCTION get_pending_xero_invoices_with_lock(INTEGER) IS 'Gets pending invoices with row-level locking using SELECT FOR UPDATE. Marks records as processing to prevent race conditions.';
COMMENT ON FUNCTION get_pending_xero_payments_with_lock(INTEGER) IS 'Gets pending payments with row-level locking using SELECT FOR UPDATE. Marks records as processing to prevent race conditions.'; 