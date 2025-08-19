-- Enable RLS on Xero tables and add admin-only policies
-- This matches the RLS configuration that exists in production

-- Enable RLS on all xero tables
ALTER TABLE xero_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_webhooks ENABLE ROW LEVEL SECURITY;

-- Create admin-only policies for all xero tables
-- Only users with is_admin = true can access these tables

CREATE POLICY "xero_contacts_admin_only" ON xero_contacts
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

CREATE POLICY "xero_invoice_line_items_admin_only" ON xero_invoice_line_items
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

CREATE POLICY "xero_invoices_admin_only" ON xero_invoices
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

CREATE POLICY "xero_oauth_tokens_admin_only" ON xero_oauth_tokens
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

CREATE POLICY "xero_payments_admin_only" ON xero_payments
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

CREATE POLICY "xero_sync_logs_admin_only" ON xero_sync_logs
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

CREATE POLICY "xero_webhooks_admin_only" ON xero_webhooks
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

-- Add comments explaining the policies
COMMENT ON POLICY "xero_contacts_admin_only" ON xero_contacts IS 
'Restricts access to Xero contacts to admin users only';

COMMENT ON POLICY "xero_invoice_line_items_admin_only" ON xero_invoice_line_items IS 
'Restricts access to Xero invoice line items to admin users only';

COMMENT ON POLICY "xero_invoices_admin_only" ON xero_invoices IS 
'Restricts access to Xero invoices to admin users only';

COMMENT ON POLICY "xero_oauth_tokens_admin_only" ON xero_oauth_tokens IS 
'Restricts access to Xero OAuth tokens to admin users only';

COMMENT ON POLICY "xero_payments_admin_only" ON xero_payments IS 
'Restricts access to Xero payments to admin users only';

COMMENT ON POLICY "xero_sync_logs_admin_only" ON xero_sync_logs IS 
'Restricts access to Xero sync logs to admin users only';

COMMENT ON POLICY "xero_webhooks_admin_only" ON xero_webhooks IS 
'Restricts access to Xero webhooks to admin users only';