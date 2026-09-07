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
--   1. Run PART 1 and review the counts.
--   2. Back up email_logs rows past retention if you want them (PART 2).
--   3. Run PART 3 to drain, ideally before 02:00 UTC so the first scheduled
--      run finds an empty backlog.
--
-- The predicates below intentionally mirror the route in
-- src/app/api/cron/daily-housekeeping/route.ts. If you change one, change the
-- other.
--
-- NOTE: this script does NOT touch xero_invoices / xero_payments. The old
-- cleanup route marked 'pending' rows 'abandoned' after 24 hours, but 'pending'
-- is the live Xero sync queue, not the pre-payment cart state ('staged'). See
-- the route's header comment.


-- ============================================================================
-- PART 1 — COUNTS ONLY. Safe to run any time; changes nothing.
-- ============================================================================

SELECT 'registrations to expire' AS sweep, count(*) AS rows
FROM user_registrations
WHERE payment_status = 'awaiting_payment'
  AND registered_at IS NULL
  AND created_at < now() - interval '1 hour'

UNION ALL

-- NOT swept, shown for visibility only: rows stuck in the Xero sync queue.
-- 'pending' is the live queue drained by /api/cron/xero-sync, not abandoned
-- carts. Anything here over a day old means a sync is stuck and needs looking
-- at — it must not be marked 'abandoned', which would drop it from the queue.
SELECT 'xero rows stuck in sync queue >24h (INVESTIGATE, do not abandon)',
       (SELECT count(*) FROM xero_invoices
         WHERE sync_status = 'pending'
           AND coalesce(staged_at, created_at) < now() - interval '24 hours')
     + (SELECT count(*) FROM xero_payments
         WHERE sync_status = 'pending'
           AND coalesce(staged_at, created_at) < now() - interval '24 hours')

UNION ALL

SELECT 'email_logs to delete (IRREVERSIBLE)', count(*)
FROM email_logs
WHERE created_at < now() - interval '90 days';

-- Oldest row in each sweep, to gauge how far back the backlog reaches.
SELECT 'registrations' AS sweep, min(created_at) AS oldest FROM user_registrations
  WHERE payment_status = 'awaiting_payment' AND registered_at IS NULL
UNION ALL
SELECT 'email_logs', min(created_at) FROM email_logs;


-- ============================================================================
-- PART 2 — OPTIONAL BACKUP of the email_logs rows PART 3 will delete.
-- The delete cannot be undone; this keeps a copy in-database.
-- ============================================================================

-- CREATE TABLE email_logs_archive_2026_09 AS
-- SELECT * FROM email_logs WHERE created_at < now() - interval '90 days';


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
