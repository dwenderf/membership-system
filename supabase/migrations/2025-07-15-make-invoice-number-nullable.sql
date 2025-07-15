-- Make invoice_number nullable in xero_invoices to allow Xero to generate its own invoice numbers
ALTER TABLE xero_invoices
ALTER COLUMN invoice_number DROP NOT NULL;

-- Make xero_invoice_id nullable in xero_invoices to allow null during staging
ALTER TABLE xero_invoices
ALTER COLUMN xero_invoice_id DROP NOT NULL;

-- Make xero_payment_id nullable in xero_payments to allow null during staging
ALTER TABLE xero_payments
ALTER COLUMN xero_payment_id DROP NOT NULL;

-- Add comments explaining the changes
COMMENT ON COLUMN xero_invoices.invoice_number IS 'Xero-generated invoice number - nullable during staging, populated when Xero creates the invoice';
COMMENT ON COLUMN xero_invoices.xero_invoice_id IS 'Xero invoice ID - nullable during staging, populated when Xero creates the invoice';
COMMENT ON COLUMN xero_payments.xero_payment_id IS 'Xero payment ID - nullable during staging, populated when Xero creates the payment'; 