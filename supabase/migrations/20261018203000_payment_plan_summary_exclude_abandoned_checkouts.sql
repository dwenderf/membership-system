-- payment_plan_summary: exclude abandoned plan checkouts.
--
-- Starting a payment plan checkout stages a DRAFT invoice with four 'staged'
-- installments before anything is paid. A completed checkout sets the invoice to
-- AUTHORISED (whether or not any installment has been charged yet); an abandoned one stays
-- DRAFT forever. The view counted 'staged' installments as upcoming, so every abandoned
-- checkout appeared as an 'active' plan with a full balance owing.
--
-- Same columns, same options (security_invoker, security_barrier) and same grants; only
-- the WHERE clause gains the DRAFT exclusion. Nothing is dropped or rewritten.
CREATE OR REPLACE VIEW public.payment_plan_summary WITH (security_invoker=true, security_barrier=true) AS
 SELECT xi.id AS invoice_id,
    (xi.staging_metadata ->> 'user_id'::text)::uuid AS contact_id,
    xi.payment_id AS first_payment_id,
    count(*) FILTER (WHERE xp.payment_type = 'installment'::text) AS total_installments,
    COALESCE(sum(xp.amount_paid) FILTER (WHERE xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'processing'::text])), 0::bigint) AS paid_amount,
    sum(xp.amount_paid) AS total_amount,
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
    json_agg(json_build_object('id', xp.id, 'installment_number', xp.installment_number, 'amount', xp.amount_paid, 'planned_payment_date', xp.planned_payment_date, 'sync_status', xp.sync_status, 'attempt_count', xp.attempt_count, 'failure_reason', xp.failure_reason) ORDER BY xp.installment_number) AS installments
   FROM xero_invoices xi
     JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
     LEFT JOIN user_registrations ur ON ur.xero_invoice_id = xi.id
     LEFT JOIN registrations r ON r.id = ur.registration_id
     LEFT JOIN seasons s ON s.id = r.season_id
  WHERE xi.is_payment_plan = true
    AND xi.invoice_status IS DISTINCT FROM 'DRAFT'
  GROUP BY xi.id, xi.staging_metadata, xi.payment_id, ur.registration_id, r.name, s.name;

COMMENT ON VIEW public.payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Includes registration data via user_registrations link, with fallback to invoice line item description for orphaned invoices. Uses COALESCE to handle NULL paid_amount when no payments are synced yet. Excludes abandoned checkouts (invoice_status DRAFT: checkout never completed).';
