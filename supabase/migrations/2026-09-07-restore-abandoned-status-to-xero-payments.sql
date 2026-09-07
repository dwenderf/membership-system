-- Restore 'abandoned' to the xero_payments sync_status check constraint.
--
-- BACKGROUND
--
-- 2025-10-19-add-abandoned-status-to-xero-sync.sql added 'abandoned' to both
-- xero_invoices_sync_status_check and xero_payments_sync_status_check, so that
-- 2025-10-19-cleanup-old-staged-records.sql could sweep abandoned carts.
--
-- 2025-11-03-add-payment-plan-support.sql then rebuilt ONLY the xero_payments
-- constraint to add 'planned' and 'cancelled', and in doing so dropped
-- 'abandoned' from the list. Its preceding "fix any invalid sync_status values"
-- block treated 'abandoned' as invalid and rewrote those rows to 'failed'.
--
-- Two consequences, both still live:
--   1. xero_invoices can hold 'abandoned' but xero_payments cannot, so any
--      cart sweep can mark an invoice abandoned while its payment row fails
--      the constraint — leaving the pair inconsistent.
--   2. Abandoned-cart payment rows now read as failed syncs. /api/xero/retry-failed
--      resets every 'failed' payment to 'pending' unscoped, so an admin using
--      "Retry Failed" can push abandoned carts into the live Xero sync queue.
--
-- This migration fixes (1). It does not reclassify the rows from (2) — see
-- scripts/drain-housekeeping-backlog.sql, which reports them so they can be
-- reviewed before any repair.
--
-- Idempotent: the constraint is dropped IF EXISTS and recreated, so re-applying
-- is safe.

ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments
ADD CONSTRAINT xero_payments_sync_status_check
CHECK (sync_status IN (
  'pending',
  'staged',
  'planned',
  'cancelled',
  'processing',
  'synced',
  'failed',
  'ignore',
  'abandoned'
));

COMMENT ON CONSTRAINT xero_payments_sync_status_check ON xero_payments IS
  'Allowed sync_status values. Mirrors xero_invoices_sync_status_check plus the payment-plan states (planned, cancelled).';
