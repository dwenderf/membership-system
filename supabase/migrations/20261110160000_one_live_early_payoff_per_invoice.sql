-- #466 (with #460): at most one live early payoff row per invoice.
--
-- processEarlyPayoff inserts a staged `full` xero_payments row before charging, and two
-- concurrent payoff requests could each insert one. Duplicates made the webhook's
-- lookup-by-invoice fail; the webhook now looks the row up by id, and this index stops the
-- duplicates being created at all. A second concurrent insert now fails with 23505, which
-- processEarlyPayoff reports as "already in progress" without charging.
--
-- Rows that are no longer live (cancelled by a rollback or superseded, abandoned, ignored) are
-- excluded, so a retry after a declined payoff still works.
--
-- Not destructive. CREATE UNIQUE INDEX fails if duplicates already exist; on 2026-11-10 both
-- development and production had none:
--   select xero_invoice_id, count(*) from public.xero_payments
--   where payment_type = 'full' and staging_metadata->>'early_payoff' = 'true'
--     and sync_status not in ('cancelled', 'abandoned', 'ignore')
--   group by 1 having count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS xero_payments_one_live_early_payoff_per_invoice
  ON public.xero_payments USING btree (xero_invoice_id)
  WHERE payment_type = 'full'
    AND (staging_metadata->>'early_payoff') = 'true'
    AND sync_status <> ALL (ARRAY['cancelled'::text, 'abandoned'::text, 'ignore'::text]);
