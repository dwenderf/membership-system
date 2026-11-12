-- payment_plan_summary: an installment in 'processing' is not paid yet.
--
-- Since #461 the installment cron claims a row by moving it to 'processing' before charging, and
-- leaves it there when Stripe's answer is unknown (a connection, API, idempotency or rate-limit
-- error after the call, or an intent that is still 'processing') until the webhook settles it or
-- an admin resolves it. Before #461 that status only lasted for the length of the Stripe call.
-- The view counted 'processing' as paid, so a plan whose last installment was stuck there read
-- 'completed', with no remaining balance. An early payoff row in 'processing' is the same: the
-- money has not arrived yet.
--
-- Changes: paid_amount and installments_paid count only 'synced' and 'pending'; status reads
-- 'active' while any row is 'planned', 'staged' or 'processing'.
--
-- Same columns, names, order and types, same options (security_invoker, security_barrier) and
-- grants. Nothing is dropped. Rollback: re-apply
-- 20261025193500_payment_plan_summary_exclude_cancelled.sql's CREATE OR REPLACE VIEW.
CREATE OR REPLACE VIEW public.payment_plan_summary WITH (security_invoker=true, security_barrier=true) AS
 SELECT xi.id AS invoice_id,
    (xi.staging_metadata ->> 'user_id'::text)::uuid AS contact_id,
    xi.payment_id AS first_payment_id,
    count(*) FILTER (WHERE xp.payment_type = 'installment'::text) AS total_installments,
    COALESCE(sum(xp.amount_paid) FILTER (WHERE xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text])), 0::bigint) AS paid_amount,
    COALESCE(sum(xp.amount_paid) FILTER (WHERE xp.sync_status <> 'cancelled'::text), 0::bigint) AS total_amount,
    max(xp.planned_payment_date) AS final_payment_date,
    min(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned'::text) AS next_payment_date,
    count(*) FILTER (WHERE (xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text])) AND xp.payment_type = 'installment'::text) AS installments_paid,
        CASE
            WHEN count(*) FILTER (WHERE xp.sync_status = 'failed'::text) > 0 THEN 'failed'::text
            WHEN count(*) FILTER (WHERE xp.sync_status = ANY (ARRAY['planned'::text, 'staged'::text, 'processing'::text])) > 0 THEN 'active'::text
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

COMMENT ON VIEW public.payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Includes registration data via user_registrations link, with fallback to invoice line item description for orphaned invoices. Uses COALESCE to handle NULL paid_amount when no payments are synced yet. Excludes abandoned checkouts (invoice_status DRAFT: checkout never completed). total_amount excludes cancelled rows (installments superseded by an early payoff, and rolled-back payoff attempts), so an early payoff no longer double-counts the balance (#452). A row in processing (charge sent, outcome not yet confirmed) counts as unpaid and keeps the plan active.';
