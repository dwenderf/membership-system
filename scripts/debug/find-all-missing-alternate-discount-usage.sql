-- ============================================================================
-- FIND: Missing discount_usage records for ALTERNATE purchases only
-- ============================================================================
-- Only looks at alternate purchases, as regular registrations are tracked correctly
-- ============================================================================

-- Find all ALTERNATE discount line items from Xero that don't have corresponding discount_usage
SELECT
  'MISSING ALTERNATE DISCOUNT USAGE' as report_type,
  xi.id as invoice_id,
  xi.invoice_number,
  xi.staged_at as invoice_datetime,
  xi.staged_at::date as invoice_date,
  (xi.staging_metadata->>'user_id')::uuid as user_id,
  u.email,
  xil.discount_code_id,
  dc.code as discount_code,
  xi.discount_amount / 100.0 as discount_dollars,
  (xi.staging_metadata->'payment_items'->0->>'item_id')::uuid as registration_id,
  r.name as registration_name,
  r.season_id,
  (xi.staging_metadata->'payment_items'->0->>'description') as description,
  -- Check if discount_usage exists (exact timestamp match)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM discount_usage du
      WHERE du.user_id = (xi.staging_metadata->>'user_id')::uuid
        AND du.discount_code_id = xil.discount_code_id
        AND du.registration_id = (xi.staging_metadata->'payment_items'->0->>'item_id')::uuid
        AND du.used_at = xi.staged_at
    ) THEN 'EXISTS ✓'
    ELSE 'MISSING ✗'
  END as status
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN registrations r ON r.id = (xi.staging_metadata->'payment_items'->0->>'item_id')::uuid
WHERE xi.sync_status = 'synced'  -- Only synced invoices
  AND xil.line_item_type = 'discount'  -- Only discount lines
  AND xil.discount_code_id IS NOT NULL  -- Must have discount code
  AND xi.discount_amount > 0  -- Must have discount
  AND xi.staging_metadata->'payment_items'->0->>'description' LIKE 'Alternate:%'  -- ONLY ALTERNATES
  -- Check if discount_usage record is missing (exact timestamp match)
  AND NOT EXISTS (
    SELECT 1 FROM discount_usage du
    WHERE du.user_id = (xi.staging_metadata->>'user_id')::uuid
      AND du.discount_code_id = xil.discount_code_id
      AND du.registration_id = (xi.staging_metadata->'payment_items'->0->>'item_id')::uuid
      AND du.used_at = xi.staged_at
  )
ORDER BY xi.staged_at DESC;

-- Count summary for ALTERNATES only
SELECT
  'SUMMARY - ALTERNATES ONLY' as report_type,
  COUNT(*) as total_missing_alternate_records,
  COUNT(DISTINCT (xi.staging_metadata->>'user_id')::uuid) as affected_users,
  SUM(xi.discount_amount) / 100.0 as total_missing_discount_dollars,
  MIN(xi.staged_at::date) as earliest_date,
  MAX(xi.staged_at::date) as latest_date
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
WHERE xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
  AND xi.discount_amount > 0
  AND xi.staging_metadata->'payment_items'->0->>'description' LIKE 'Alternate:%'
  AND NOT EXISTS (
    SELECT 1 FROM discount_usage du
    WHERE du.user_id = (xi.staging_metadata->>'user_id')::uuid
      AND du.discount_code_id = xil.discount_code_id
      AND du.registration_id = (xi.staging_metadata->'payment_items'->0->>'item_id')::uuid
      AND du.used_at = xi.staged_at
  );

-- Breakdown by user for ALTERNATES
SELECT
  'BY USER - ALTERNATES ONLY' as report_type,
  (xi.staging_metadata->>'user_id')::uuid as user_id,
  u.email,
  COUNT(*) as missing_alternate_count,
  SUM(xi.discount_amount) / 100.0 as total_missing_dollars
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
WHERE xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
  AND xi.discount_amount > 0
  AND xi.staging_metadata->'payment_items'->0->>'description' LIKE 'Alternate:%'
  AND NOT EXISTS (
    SELECT 1 FROM discount_usage du
    WHERE du.user_id = (xi.staging_metadata->>'user_id')::uuid
      AND du.discount_code_id = xil.discount_code_id
      AND du.registration_id = (xi.staging_metadata->'payment_items'->0->>'item_id')::uuid
      AND du.used_at = xi.staged_at
  )
GROUP BY (xi.staging_metadata->>'user_id')::uuid, u.email
ORDER BY missing_alternate_count DESC;
