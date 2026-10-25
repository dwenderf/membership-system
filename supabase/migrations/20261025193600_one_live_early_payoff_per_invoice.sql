-- One live early payoff per payment plan invoice (#452).
--
-- Backstop for the atomic claim in PaymentPlanService.processEarlyPayoff: at most one
-- early-payoff 'full' xero_payments row per invoice may be staged/pending/processing/synced.
-- A second concurrent payoff's insert fails with 23505 and is rolled back before any charge.
-- Cancelled (rolled-back) and failed attempts are outside the predicate, so a retry after a
-- declined card still works.
--
-- NOT destructive. The pre-check below raises (and the whole migration rolls back, creating
-- nothing) if existing data already has duplicate live payoffs - resolve those by hand first
-- (they are possible double charges; see #452 for the read-only query and Stripe check).
-- Rollback: DROP INDEX IF EXISTS public.xero_payments_one_live_early_payoff;
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(xero_invoice_id::text || ' (' || n || ')', ', ')
    INTO dupes
    FROM (
      SELECT xero_invoice_id, count(*) AS n
        FROM public.xero_payments
       WHERE payment_type = 'full'
         AND (staging_metadata ->> 'early_payoff') = 'true'
         AND sync_status = ANY (ARRAY['staged'::text, 'pending'::text, 'processing'::text, 'synced'::text])
       GROUP BY xero_invoice_id
      HAVING count(*) > 1
    ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create xero_payments_one_live_early_payoff: invoices with more than one live early payoff row: %. Resolve these (possible double charges) before applying.', dupes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS xero_payments_one_live_early_payoff
  ON public.xero_payments USING btree (xero_invoice_id)
  WHERE payment_type = 'full'
    AND (staging_metadata ->> 'early_payoff') = 'true'
    AND sync_status = ANY (ARRAY['staged'::text, 'pending'::text, 'processing'::text, 'synced'::text]);

COMMENT ON INDEX public.xero_payments_one_live_early_payoff IS 'At most one live (staged/pending/processing/synced) early-payoff row per payment plan invoice (#452).';
