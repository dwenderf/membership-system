-- Make tenant_id nullable in xero_invoices table for staging
-- The tenant_id should only be required when actually syncing to Xero, not during staging

-- Drop the NOT NULL constraint and foreign key reference
ALTER TABLE xero_invoices 
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Drop the foreign key constraint temporarily
ALTER TABLE xero_invoices 
  DROP CONSTRAINT IF EXISTS xero_invoices_tenant_id_fkey;

-- Add the foreign key constraint back but allow NULL values
ALTER TABLE xero_invoices 
  ADD CONSTRAINT xero_invoices_tenant_id_fkey 
  FOREIGN KEY (tenant_id) REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE;

-- Update the unique constraint to handle NULL tenant_id
-- We need to drop and recreate the unique constraint
ALTER TABLE xero_invoices 
  DROP CONSTRAINT IF EXISTS xero_invoices_payment_id_tenant_id_key;

-- Create a new unique constraint that allows multiple records with NULL tenant_id
-- but ensures uniqueness when tenant_id is provided
CREATE UNIQUE INDEX xero_invoices_payment_tenant_unique 
  ON xero_invoices (payment_id, tenant_id) 
  WHERE tenant_id IS NOT NULL;

-- Add a comment explaining the staging flow
COMMENT ON TABLE xero_invoices IS 'Xero invoice staging and sync tracking. tenant_id is NULL during staging and populated during sync.';

-- Also make tenant_id nullable in xero_payments table for staging
ALTER TABLE xero_payments 
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Drop the foreign key constraint temporarily
ALTER TABLE xero_payments 
  DROP CONSTRAINT IF EXISTS xero_payments_tenant_id_fkey;

-- Add the foreign key constraint back but allow NULL values
ALTER TABLE xero_payments 
  ADD CONSTRAINT xero_payments_tenant_id_fkey 
  FOREIGN KEY (tenant_id) REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE;

-- Update the unique constraint to handle NULL tenant_id
ALTER TABLE xero_payments 
  DROP CONSTRAINT IF EXISTS xero_payments_xero_invoice_id_tenant_id_key;

-- Create a new unique constraint that allows multiple records with NULL tenant_id
-- but ensures uniqueness when tenant_id is provided
CREATE UNIQUE INDEX xero_payments_invoice_tenant_unique 
  ON xero_payments (xero_invoice_id, tenant_id) 
  WHERE tenant_id IS NOT NULL;

-- Add a comment explaining the staging flow
COMMENT ON TABLE xero_payments IS 'Xero payment staging and sync tracking. tenant_id is NULL during staging and populated during sync.'; 