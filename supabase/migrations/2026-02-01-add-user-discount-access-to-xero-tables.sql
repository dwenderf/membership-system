-- Add RLS policies to allow users to access their own discount usage via xero tables
-- This allows non-admin users to query discount_usage_computed view which reads from xero_invoice_line_items

-- Allow users to view xero_invoice_line_items for their own payments (discount usage tracking)
CREATE POLICY "xero_invoice_line_items_user_discount_access" ON xero_invoice_line_items
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 
      FROM xero_invoices xi
      LEFT JOIN payments p ON xi.payment_id = p.id
      WHERE xi.id = xero_invoice_line_items.xero_invoice_id
      AND p.user_id = auth.uid()
    )
  );

-- Allow users to view xero_invoices for their own payments (discount usage tracking)
CREATE POLICY "xero_invoices_user_discount_access" ON xero_invoices
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 
      FROM payments p
      WHERE p.id = xero_invoices.payment_id
      AND p.user_id = auth.uid()
    )
  );

-- Add comments explaining the policies
COMMENT ON POLICY "xero_invoice_line_items_user_discount_access" ON xero_invoice_line_items IS 
'Allows users to view xero invoice line items for their own payments. This enables access to the discount_usage_computed view for checking personal discount usage.';

COMMENT ON POLICY "xero_invoices_user_discount_access" ON xero_invoices IS 
'Allows users to view xero invoices for their own payments. This supports discount usage tracking and the discount_usage_computed view.';
