-- Fix payment_plan_summary view to handle NULL paid_amount
-- When no payments match the filter, SUM returns NULL instead of 0, causing incorrect calculations

DROP VIEW IF EXISTS payment_plan_summary CASCADE;

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
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'planned') = 0 THEN 'completed'
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'failed') > 0 THEN 'failed'
    ELSE 'active'
  END as status,
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
WHERE xi.is_payment_plan = true
GROUP BY xi.id, xi.staging_metadata, xi.payment_id;

-- Restrict access to admin users only (service_role)
ALTER VIEW payment_plan_summary SET (security_barrier = true);

-- Revoke public access
REVOKE ALL ON payment_plan_summary FROM PUBLIC;
REVOKE ALL ON payment_plan_summary FROM anon;
REVOKE ALL ON payment_plan_summary FROM authenticated;

-- Grant access only to service_role (used by admin APIs and cron jobs)
GRANT SELECT ON payment_plan_summary TO service_role;

COMMENT ON VIEW payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Uses COALESCE to handle NULL paid_amount when no payments are synced yet.';
