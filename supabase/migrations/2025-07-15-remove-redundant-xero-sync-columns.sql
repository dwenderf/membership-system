-- Remove redundant Xero sync columns from user_registrations table
-- These are now properly tracked in the xero_invoices staging table

-- Drop the redundant columns
ALTER TABLE user_registrations 
DROP COLUMN IF EXISTS xero_synced,
DROP COLUMN IF EXISTS xero_sync_error;

-- Add comment explaining the change
COMMENT ON TABLE user_registrations IS 'User registration records. Xero sync status is tracked in xero_invoices staging table.'; 