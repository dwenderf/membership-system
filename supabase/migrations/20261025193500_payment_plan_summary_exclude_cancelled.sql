-- payment_plan_summary: stop counting cancelled rows in total_amount (#452).
--
-- An early payoff cancels the remaining 'planned' installments and adds one 'full' row for the
-- same amount. total_amount summed every row, so a paid-off plan reported the cancelled balance
-- twice (e.g. $125 plan -> total $218.75, "remaining" $93.75 after payoff, $187.50 mid-payoff).
-- total_amount now ignores cancelled rows; a payoff attempt that is rolled back (staged row
-- cancelled, installments restored to planned) therefore drops out too. The installments JSON
-- also omits cancelled 'full' rows (rolled-back payoff attempts, which have no installment number).
--
-- Same columns, names, order and types (total_amount stays bigint via COALESCE), same options
-- (security_invoker, security_barrier) and grants. Nothing is dropped. Rollback: re-apply
-- 20261018203000_payment_plan_summary_exclude_abandoned_checkouts.sql's CREATE OR REPLACE VIEW.
CREATE OR REPLACE VIEW public.payment_plan_summary WITH (security_invoker=true, security_barrier=true) AS
 SELECT xi.id AS invoice_id,
    (xi.staging_metadata ->> 'user_id'::text)::uuid AS contact_id,
    xi.payment_id AS first_payment_id,
    count(*) FILTER (WHERE xp.payment_type = 'installment'::text) AS total_installments,
    COALESCE(sum(xp.amount_paid) FILTER (WHERE xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'processing'::text])), 0::bigint) AS paid_amount,
    COALESCE(sum(xp.amount_paid) FILTER (WHERE xp.sync_status <> 'cancelled'::text), 0::bigint) AS total_amount,
    max(xp.planned_payment_date) AS final_payment_date,
    min(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned'::text) AS next_payment_date,
    count(*) FILTER (WHERE (xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'processing'::text])) AND xp.payment_type = 'installment'::text) AS installments_paid,
        CASE
            WHEN count(*) FILTER (WHERE xp.sync_status = 'failed'::text) > 0 THEN 'failed'::text
            WHEN count(*) FILTER (WHERE xp.sync_status = ANY (ARRAY['planned'::text, 'staged'::text])) > 0 THEN 'active'::text
            ELSE 'completed'::text
        END AS status,
    ur.registration_id,
    COALESCE(r.name, NULLIF(regexp_replace(( SELECT xero_invoice_line_items.description
           FROM xero_invoice_line_items
          WHERE xero_invoice_line_items.xero_invoice_id = xi.id
          ORDER BY xero_invoice_line_items.id
         LIMIT 1), '^Registration:\s*'::text, ''::text), ''::text)) AS registration_name,
    s.name AS season_name,
    json_agg(json_build_object('id', xp.id, 'installment_number', xp.installment_number, 'amount', xp.amount_paid, 'planned_payment_date', xp.planned_payment_date, 'sync_status', xp.sync_status, 'attempt_count', xp.attempt_count, 'failure_reason', xp.failure_reason) ORDER BY xp.installment_number) FILTER (WHERE NOT (xp.payment_type = 'full'::text AND xp.sync_status = 'cancelled'::text)) AS installments
   FROM xero_invoices xi
     JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
     LEFT JOIN user_registrations ur ON ur.xero_invoice_id = xi.id
     LEFT JOIN registrations r ON r.id = ur.registration_id
     LEFT JOIN seasons s ON s.id = r.season_id
  WHERE xi.is_payment_plan = true
    AND xi.invoice_status IS DISTINCT FROM 'DRAFT'
  GROUP BY xi.id, xi.staging_metadata, xi.payment_id, ur.registration_id, r.name, s.name;

COMMENT ON VIEW public.payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Includes registration data via user_registrations link, with fallback to invoice line item description for orphaned invoices. Uses COALESCE to handle NULL paid_amount when no payments are synced yet. Excludes abandoned checkouts (invoice_status DRAFT: checkout never completed). total_amount excludes cancelled rows (installments superseded by an early payoff, and rolled-back payoff attempts), so an early payoff no longer double-counts the balance (#452).';
