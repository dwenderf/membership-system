-- Enhance Xero tables for robust staging approach
-- Adds 'staged' status and staging metadata fields

-- Extend xero_invoices sync_status to include 'staged'
ALTER TABLE xero_invoices 
DROP CONSTRAINT IF EXISTS xero_invoices_sync_status_check;

ALTER TABLE xero_invoices 
ADD CONSTRAINT xero_invoices_sync_status_check 
CHECK (sync_status IN ('pending', 'staged', 'synced', 'failed', 'needs_update'));

-- Extend xero_payments sync_status to include 'staged' and 'needs_update'
ALTER TABLE xero_payments 
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments 
ADD CONSTRAINT xero_payments_sync_status_check 
CHECK (sync_status IN ('pending', 'staged', 'synced', 'failed', 'needs_update'));

-- Add staging metadata fields
ALTER TABLE xero_invoices 
ADD COLUMN staged_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN staging_metadata JSONB;

ALTER TABLE xero_payments 
ADD COLUMN staged_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN staging_metadata JSONB;

-- Create indexes for staging queries
CREATE INDEX idx_xero_invoices_staging 
ON xero_invoices(sync_status, staged_at) 
WHERE sync_status IN ('pending', 'staged');

CREATE INDEX idx_xero_payments_staging 
ON xero_payments(sync_status, staged_at) 
WHERE sync_status IN ('pending', 'staged');

-- Add comments
COMMENT ON COLUMN xero_invoices.staged_at IS 'When invoice was staged for sync';
COMMENT ON COLUMN xero_invoices.staging_metadata IS 'Additional staging context and validation data';
COMMENT ON COLUMN xero_payments.staged_at IS 'When payment was staged for sync';
COMMENT ON COLUMN xero_payments.staging_metadata IS 'Additional staging context and validation data';