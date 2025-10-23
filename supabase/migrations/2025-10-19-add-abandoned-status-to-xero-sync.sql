-- Add 'abandoned' status to Xero sync_status enum
-- This status is used to mark staging records that were created but the user
-- abandoned the purchase (e.g., closed the payment modal without completing).
-- This prevents abandoned records from being incorrectly matched to future payments.

-- Update xero_invoices sync_status check constraint
ALTER TABLE xero_invoices
DROP CONSTRAINT IF EXISTS xero_invoices_sync_status_check;

ALTER TABLE xero_invoices
ADD CONSTRAINT xero_invoices_sync_status_check
CHECK (sync_status IN ('pending', 'staged', 'processing', 'synced', 'failed', 'ignore', 'abandoned'));

-- Update xero_payments sync_status check constraint
ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments
ADD CONSTRAINT xero_payments_sync_status_check
CHECK (sync_status IN ('pending', 'staged', 'processing', 'synced', 'failed', 'ignore', 'abandoned'));

-- Update comments to explain the new status
COMMENT ON COLUMN xero_invoices.sync_status IS 'pending=ready for sync, staged=created but not ready, processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required), abandoned=user cancelled purchase before payment';
COMMENT ON COLUMN xero_payments.sync_status IS 'pending=ready for sync, staged=created but not ready, processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required), abandoned=user cancelled purchase before payment';

-- Create index on abandoned status for cleanup queries
CREATE INDEX IF NOT EXISTS idx_xero_invoices_abandoned
ON xero_invoices(sync_status, staged_at)
WHERE sync_status = 'abandoned';

CREATE INDEX IF NOT EXISTS idx_xero_payments_abandoned
ON xero_payments(sync_status, staged_at)
WHERE sync_status = 'abandoned';
