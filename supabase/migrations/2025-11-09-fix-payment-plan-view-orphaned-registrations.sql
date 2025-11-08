-- Fix payment_plan_summary view to handle orphaned invoices
-- When user_registration link doesn't exist, fall back to invoice line item description

CREATE OR REPLACE VIEW payment_plan_summary
WITH (security_invoker = true)
AS
SELECT
  xi.id as invoice_id,
  (xi.staging_metadata->>'user_id')::uuid as contact_id,
  xi.payment_id as first_payment_id,
  COUNT(*) FILTER (WHERE xp.payment_type = 'installment') as total_installments,
  COALESCE(SUM(xp.amount_paid) FILTER (WHERE xp.sync_status IN ('synced','pending','processing')), 0) as paid_amount,
  SUM(xp.amount_paid) as total_amount,
  MAX(xp.planned_payment_date) as final_payment_date,
  MIN(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned') as next_payment_date,
  COUNT(*) FILTER (WHERE xp.sync_status IN ('synced','pending','processing') AND xp.payment_type = 'installment') as installments_paid,
  CASE
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'failed') > 0 THEN 'failed'
    WHEN COUNT(*) FILTER (WHERE xp.sync_status IN ('planned', 'staged')) > 0 THEN 'active'
    ELSE 'completed'
  END as status,
  -- Registration information (from user_registrations via xero_invoice_id)
  ur.registration_id,
  -- Use registration name if available, otherwise fall back to line item description
  -- Line item descriptions for registrations typically contain "Registration: <name>"
  COALESCE(
    r.name,
    -- Extract registration name from first line item description
    -- Remove "Registration: " prefix if present, otherwise use full description
    NULLIF(
      regexp_replace(
        (SELECT description FROM xero_invoice_line_items WHERE xero_invoice_id = xi.id ORDER BY id LIMIT 1),
        '^Registration:\s*',
        ''
      ),
      ''
    )
  ) as registration_name,
  s.name as season_name,
  -- Installment details
  json_agg(
    json_build_object(
      'id', xp.id,
      'installment_number', xp.installment_number,
      'amount', xp.amount_paid,
      'planned_payment_date', xp.planned_payment_date,
      'sync_status', xp.sync_status,
      'attempt_count', xp.attempt_count,
      'failure_reason', xp.failure_reason
    ) ORDER BY xp.installment_number
  ) as installments
FROM xero_invoices xi
JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
LEFT JOIN user_registrations ur ON ur.xero_invoice_id = xi.id
LEFT JOIN registrations r ON r.id = ur.registration_id
LEFT JOIN seasons s ON s.id = r.season_id
WHERE xi.is_payment_plan = true
GROUP BY xi.id, xi.staging_metadata, xi.payment_id, ur.registration_id, r.name, s.name;

-- Restrict access to admin users only (service_role)
ALTER VIEW payment_plan_summary SET (security_barrier = true);

-- Revoke public access
REVOKE ALL ON payment_plan_summary FROM PUBLIC;
REVOKE ALL ON payment_plan_summary FROM anon;
REVOKE ALL ON payment_plan_summary FROM authenticated;

-- Grant access only to service_role (used by admin APIs and cron jobs)
GRANT SELECT ON payment_plan_summary TO service_role;

COMMENT ON VIEW payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Includes registration data via user_registrations link, with fallback to invoice line item description for orphaned invoices. Uses COALESCE to handle NULL paid_amount when no payments are synced yet.';
