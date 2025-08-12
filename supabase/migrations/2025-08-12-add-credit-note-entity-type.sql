-- Add 'credit_note_sync' to operation_type and 'credit_note' to entity_type constraints
-- This allows logging of credit note sync operations in the sync activity

-- Drop the existing operation_type constraint
ALTER TABLE xero_sync_logs DROP CONSTRAINT IF EXISTS xero_sync_logs_operation_type_check;

-- Drop the existing entity_type constraint  
ALTER TABLE xero_sync_logs DROP CONSTRAINT IF EXISTS xero_sync_logs_entity_type_check;

-- Add the new operation_type constraint with credit_note_sync included
ALTER TABLE xero_sync_logs ADD CONSTRAINT xero_sync_logs_operation_type_check 
CHECK (operation_type IN ('contact_sync', 'invoice_sync', 'payment_sync', 'token_refresh', 'credit_note_sync'));

-- Add the new entity_type constraint with credit_note included
ALTER TABLE xero_sync_logs ADD CONSTRAINT xero_sync_logs_entity_type_check 
CHECK (entity_type IN ('user', 'payment', 'invoice', 'contact', 'credit_note'));