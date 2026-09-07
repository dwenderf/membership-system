-- Drain the housekeeping backlog before /api/cron/daily-housekeeping first runs.
--
-- WHY THIS IS NEEDED
--
-- The predecessor route (/api/cron/cleanup) ran with the anon-key Supabase
-- client. Every table it wrote to has RLS enabled with policies keyed on
-- auth.uid(), and a cron request carries no session, so each statement matched
-- zero rows and returned success. The job appeared to run nightly while doing
-- nothing. Its sibling (/api/cron/maintenance) used the correct service-role
-- client but was never declared in vercel.json, so it never ran at all.
--
-- The replacement job uses the service-role client and does work. Its first run
-- would therefore hit the entire accumulated backlog in one pass, including an
-- irreversible DELETE against email_logs of unknown size.
--
-- Run this script first, as the maintainer, from the Supabase SQL editor (which
-- connects as the table owner and so is not subject to the RLS policies that
-- silently blocked the old job). Once drained, steady state is only ever one
-- day's worth of rows and the nightly job needs no batching.
--
-- ORDER OF OPERATIONS
--   1. Run PART 1 and review the counts. It is one statement on purpose — the
--      Supabase SQL editor shows only the last statement's result per run.
--   2. Back up email_logs rows past retention if you want them (PART 2).
--   3. Run PART 3 to drain, ideally before 02:00 UTC so the first scheduled
--      run finds an empty backlog.
--
-- The predicates below intentionally mirror the route in
-- src/app/api/cron/daily-housekeeping/route.ts. If you change one, change the
-- other.
--
-- NOTE on Xero rows: this script sweeps abandoned CARTS only — 'staged' rows
-- with payment_id still null. It never touches 'pending' rows: that is the live
-- Xero sync queue drained by /api/cron/xero-sync, and abandoning those would
-- drop real accounting records. The old cleanup route confused the two.
--
-- PREREQUISITE: apply
-- supabase/migrations/2026-09-07-restore-abandoned-status-to-xero-payments.sql
-- first. Until it is applied, xero_payments' check constraint rejects
-- 'abandoned' and PART 3's payments update will fail.


-- ============================================================================
-- PART 1 — COUNTS ONLY. Safe to run any time; changes nothing.
--
-- Deliberately ONE statement: the Supabase SQL editor only shows the result of
-- the last statement in a run, so splitting this would silently hide the counts.
-- ============================================================================

SELECT 1 AS step,
       'registrations to expire' AS sweep,
       count(*) AS rows,
       min(created_at) AS oldest
FROM user_registrations
WHERE payment_status = 'awaiting_payment'
  AND registered_at IS NULL
  AND created_at < now() - interval '1 hour'

UNION ALL

SELECT 2,
       'abandoned carts to sweep (invoices)',
       count(*),
       min(coalesce(staged_at, created_at))
FROM xero_invoices
WHERE sync_status = 'staged'
  AND payment_id IS NULL
  AND coalesce(staged_at, created_at) < now() - interval '24 hours'

UNION ALL

-- NOT swept, shown for visibility only: rows stuck in the Xero sync queue.
-- 'pending' is the live queue drained by /api/cron/xero-sync, not abandoned
-- carts. Anything here over a day old means a sync is stuck and needs looking
-- at — it must not be marked 'abandoned', which would drop it from the queue.
SELECT 3,
       'xero rows stuck in sync queue >24h (INVESTIGATE, do not abandon)',
       count(*),
       min(ts)
FROM (
  SELECT coalesce(staged_at, created_at) AS ts
  FROM xero_invoices
  WHERE sync_status = 'pending'
    AND coalesce(staged_at, created_at) < now() - interval '24 hours'
  UNION ALL
  SELECT coalesce(staged_at, created_at)
  FROM xero_payments
  WHERE sync_status = 'pending'
    AND coalesce(staged_at, created_at) < now() - interval '24 hours'
) stuck

UNION ALL

-- NOT repaired here, reported for review: payment rows that 2025-11-03's
-- "fix invalid sync_status values" block rewrote from 'abandoned' to 'failed'.
-- These read as failed syncs, and /api/xero/retry-failed resets every 'failed'
-- payment to 'pending' unscoped — so they can be pushed into the live sync
-- queue by an admin clicking "Retry Failed". See PART 2b.
SELECT 4,
       'payments misclassified as failed (parent invoice abandoned)',
       count(*),
       min(p.updated_at)
FROM xero_payments p
JOIN xero_invoices i ON i.id = p.xero_invoice_id
WHERE p.sync_status = 'failed'
  AND i.sync_status = 'abandoned'

UNION ALL

-- If this count is large, use the chunked DELETE in PART 3 rather than the
-- single statement, to avoid holding a long lock.
SELECT 5,
       'email_logs to delete (IRREVERSIBLE)',
       count(*),
       min(created_at)
FROM email_logs
WHERE created_at < now() - interval '90 days'

ORDER BY step;


-- ============================================================================
-- PART 2 — OPTIONAL BACKUP of the email_logs rows PART 3 will delete.
-- The delete cannot be undone; this keeps a copy in-database.
-- ============================================================================

-- CREATE TABLE email_logs_archive_2026_09 AS
-- SELECT * FROM email_logs WHERE created_at < now() - interval '90 days';


-- ============================================================================
-- PART 2b — OPTIONAL REPAIR of payments misclassified as 'failed' by the
-- 2025-11-03 migration. Review the PART 1 count and inspect the rows first.
-- Requires the 2026-09-07 constraint migration to be applied.
-- ============================================================================

-- SELECT p.id, p.sync_status, p.sync_error, p.updated_at, i.sync_status AS invoice_status
-- FROM xero_payments p
-- JOIN xero_invoices i ON i.id = p.xero_invoice_id
-- WHERE p.sync_status = 'failed' AND i.sync_status = 'abandoned';

-- UPDATE xero_payments p
-- SET sync_status = 'abandoned',
--     sync_error = 'Reclassified from failed - parent invoice was an abandoned cart'
-- FROM xero_invoices i
-- WHERE i.id = p.xero_invoice_id
--   AND p.sync_status = 'failed'
--   AND i.sync_status = 'abandoned';


-- ============================================================================
-- PART 3 — THE DRAIN. Review PART 1 output before running.
-- Wrapped in a transaction: inspect the row counts, then COMMIT or ROLLBACK.
-- ============================================================================

BEGIN;

-- Abandoned checkouts. registered_at IS NULL is the safe "never completed"
-- signal — it is only written at payment completion, so refunded rows (which
-- have it set) and other terminal statuses are correctly excluded. Deliberately
-- NOT filtered on reservation_expires_at: unlimited-capacity categories never
-- set that field but can still be abandoned.
UPDATE user_registrations
SET payment_status = 'expired',
    reservation_expires_at = NULL
WHERE payment_status = 'awaiting_payment'
  AND registered_at IS NULL
  AND created_at < now() - interval '1 hour';

-- Abandoned carts, narrow definition: 'staged' with payment_id still NULL.
-- NOTE: payment_id is stamped at payment-INTENT creation, not completion, so
-- this only matches carts abandoned BEFORE the Stripe step. Carts abandoned at
-- or after it keep a payment_id and are deliberately left alone — some of those
-- may be payments that succeeded while the completion processor failed to
-- promote them, which is unsynced revenue rather than an abandoned cart. See
-- the route's header comment. Payments are updated before invoices so a
-- constraint failure on the payments side leaves the pair consistent.
UPDATE xero_payments p
SET sync_status = 'abandoned',
    sync_error = 'Automatically marked as abandoned - staged over 24 hours without payment completion'
FROM xero_invoices i
WHERE i.id = p.xero_invoice_id
  AND p.sync_status = 'staged'
  AND i.sync_status = 'staged'
  AND i.payment_id IS NULL
  AND coalesce(i.staged_at, i.created_at) < now() - interval '24 hours';

UPDATE xero_invoices
SET sync_status = 'abandoned',
    sync_error = 'Automatically marked as abandoned - staged over 24 hours without payment completion'
WHERE sync_status = 'staged'
  AND payment_id IS NULL
  AND coalesce(staged_at, created_at) < now() - interval '24 hours';

-- Email logs past the 90-day retention window. IRREVERSIBLE once committed.
--
-- If PART 1 reported a very large count, delete in chunks instead of one
-- statement to avoid holding a long lock — repeat until it reports 0 rows:
--
--   DELETE FROM email_logs
--   WHERE id IN (
--     SELECT id FROM email_logs
--     WHERE created_at < now() - interval '90 days'
--     LIMIT 5000
--   );
--
DELETE FROM email_logs
WHERE created_at < now() - interval '90 days';

-- Inspect the reported row counts above, then:
--   COMMIT;    -- to apply
--   ROLLBACK;  -- to discard
COMMIT;


-- ============================================================================
-- PART 4 — VERIFY. Re-run PART 1; every count should be 0 (or only rows that
-- crossed the threshold while you were working).
-- ============================================================================
