-- Utility script to identify orphaned payment plan invoices
-- These are invoices marked as payment plans but have no linked user_registration

-- Find all payment plan invoices without a linked registration
WITH orphaned_invoices AS (
  SELECT
    xi.id,
    xi.xero_invoice_id,
    xi.invoice_number,
    xi.contact_id,
    xi.total_amount,
    xi.invoice_status,
    xi.sync_status,
    xi.staging_metadata,
    xi.created_at
  FROM xero_invoices xi
  WHERE xi.is_payment_plan = true
    AND xi.invoice_type = 'ACCREC'
    AND NOT EXISTS (
      SELECT 1
      FROM user_registrations ur
      WHERE ur.xero_invoice_id = xi.id
    )
)
SELECT
  oi.id,
  oi.xero_invoice_id,
  oi.invoice_number,
  oi.contact_id,
  u.email as user_email,
  u.first_name,
  u.last_name,
  oi.total_amount,
  oi.invoice_status,
  oi.sync_status,
  oi.staging_metadata->>'registration_id' as missing_registration_id,
  oi.staging_metadata->>'registration_name' as missing_registration_name,
  oi.created_at,
  -- Count associated payment installments
  (SELECT COUNT(*)
   FROM xero_payments xp
   WHERE xp.xero_invoice_id = oi.id
     AND xp.payment_type = 'installment') as installment_count,
  -- Sum of payments made
  (SELECT COALESCE(SUM(xp.amount_paid), 0)
   FROM xero_payments xp
   WHERE xp.xero_invoice_id = oi.id
     AND xp.payment_type = 'installment'
     AND xp.sync_status = 'synced') as amount_paid
FROM orphaned_invoices oi
LEFT JOIN users u ON u.id = oi.contact_id
ORDER BY oi.created_at DESC;

-- Additional query: Check if the registration IDs from staging_metadata exist anywhere
\echo '\n--- Checking if registration IDs from staging_metadata exist ---\n'

WITH orphaned_invoices AS (
  SELECT
    xi.id,
    xi.staging_metadata->>'registration_id' as registration_id,
    xi.staging_metadata->>'registration_name' as registration_name
  FROM xero_invoices xi
  WHERE xi.is_payment_plan = true
    AND xi.invoice_type = 'ACCREC'
    AND NOT EXISTS (
      SELECT 1
      FROM user_registrations ur
      WHERE ur.xero_invoice_id = xi.id
    )
    AND xi.staging_metadata->>'registration_id' IS NOT NULL
)
SELECT
  oi.registration_id,
  oi.registration_name,
  CASE
    WHEN r.id IS NOT NULL THEN 'Registration exists but not linked'
    ELSE 'Registration completely missing'
  END as status,
  r.id as found_registration_id,
  r.xero_invoice_id as linked_invoice_id,
  r.payment_status,
  r.deleted_at
FROM orphaned_invoices oi
LEFT JOIN registrations r ON r.id::text = oi.registration_id
ORDER BY oi.registration_name;

-- Potential fix query (commented out for safety)
-- To link orphaned invoices to their registrations if they exist:
/*
UPDATE user_registrations ur
SET xero_invoice_id = oi.id
FROM orphaned_invoices oi
JOIN registrations r ON r.id::text = oi.staging_metadata->>'registration_id'
WHERE ur.registration_id = r.id
  AND ur.xero_invoice_id IS NULL
  AND oi.contact_id = ur.user_id;
*/
