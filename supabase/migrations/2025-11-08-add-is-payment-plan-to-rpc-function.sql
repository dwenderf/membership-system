-- Add is_payment_plan field to get_pending_xero_invoices_with_lock RPC function
-- This allows the sync code to detect payment plans and set correct due dates

-- Drop the old function first (required when changing return type)
DROP FUNCTION IF EXISTS get_pending_xero_invoices_with_lock(integer);

-- Create the function with the updated return type
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
          'item_type', xil.item_type,
          'discount_code_id', xil.discount_code_id,
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
  FROM xero_invoices xi
  LEFT JOIN xero_invoice_line_items xil ON xi.id = xil.xero_invoice_id
  WHERE xi.sync_status = 'pending'
  GROUP BY xi.id
  ORDER BY xi.created_at ASC
  LIMIT limit_count
  FOR UPDATE OF xi SKIP LOCKED;
END;
$$;

COMMENT ON FUNCTION get_pending_xero_invoices_with_lock(INTEGER) IS
'Gets pending invoices with row-level locking using SELECT FOR UPDATE. Marks records as processing to prevent race conditions. Includes is_payment_plan field for correct due date calculation.';
