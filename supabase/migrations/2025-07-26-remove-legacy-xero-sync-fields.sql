-- Remove legacy Xero sync fields from existing tables
-- These fields are no longer needed since we now use dedicated xero_invoices and xero_payments tables

-- Remove legacy fields from payments table
ALTER TABLE payments DROP COLUMN IF EXISTS xero_synced;
ALTER TABLE payments DROP COLUMN IF EXISTS xero_sync_error;

-- Remove legacy fields from user_memberships table  
ALTER TABLE user_memberships DROP COLUMN IF EXISTS xero_synced;
ALTER TABLE user_memberships DROP COLUMN IF EXISTS xero_sync_error;

-- Remove legacy fields from user_registrations table
ALTER TABLE user_registrations DROP COLUMN IF EXISTS xero_synced;
ALTER TABLE user_registrations DROP COLUMN IF EXISTS xero_sync_error;

-- Drop legacy indexes that are no longer needed
DROP INDEX IF EXISTS idx_payments_xero_synced;
DROP INDEX IF EXISTS idx_user_memberships_xero_synced;
DROP INDEX IF EXISTS idx_user_registrations_xero_synced;

-- Add comments to document the change
COMMENT ON TABLE xero_invoices IS 'Primary table for tracking Xero invoice synchronization status. Replaces legacy xero_synced fields.';
COMMENT ON TABLE xero_payments IS 'Primary table for tracking Xero payment synchronization status. Replaces legacy xero_synced fields.'; 