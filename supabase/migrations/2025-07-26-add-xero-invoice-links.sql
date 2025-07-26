-- Add direct links from business records to Xero invoices
-- This solves the linking problem for zero-value purchases that don't have payment records

-- Add xero_invoice_id to user_memberships table
ALTER TABLE user_memberships 
ADD COLUMN xero_invoice_id UUID REFERENCES xero_invoices(id);

-- Add xero_invoice_id to user_registrations table  
ALTER TABLE user_registrations 
ADD COLUMN xero_invoice_id UUID REFERENCES xero_invoices(id);

-- Create indexes for efficient lookups
CREATE INDEX idx_user_memberships_xero_invoice_id ON user_memberships(xero_invoice_id);
CREATE INDEX idx_user_registrations_xero_invoice_id ON user_registrations(xero_invoice_id);

-- Add comments to document the relationship
COMMENT ON COLUMN user_memberships.xero_invoice_id IS 'Direct link to Xero invoice. Used for zero-value purchases that do not have payment records.';
COMMENT ON COLUMN user_registrations.xero_invoice_id IS 'Direct link to Xero invoice. Used for zero-value purchases that do not have payment records.'; 