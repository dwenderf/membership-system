-- ============================================================================
-- DIAGNOSTIC SCRIPT: Find Stuck Xero Invoices (Completed but Not Synced)
-- ============================================================================
-- Purpose: Identify invoices that were COMPLETED but stuck in 'staged' status
--          (NOT abandoned registrations - those are expected to be staged)
--
-- Issue: Before Oct 22, 2025, zero-value alternate charges didn't trigger
--        payment completion processing, leaving completed invoices stuck
--
-- Key Distinction:
-- - Expected 'staged': User started but didn't complete → stays staged → abandoned
-- - Stuck 'staged': User COMPLETED purchase → should be 'pending' → stuck!
-- ============================================================================

-- ============================================================================
-- SECTION 1: Stuck Completed Invoices (Has Payment Record)
-- ============================================================================
-- These are invoices that have an associated payment record, meaning the
-- user completed the purchase, but the invoice never transitioned to pending
SELECT
  '=== STUCK INVOICES WITH PAYMENT RECORDS ===' as section,
  xi.id as invoice_id,
  xi.staged_at::date as staged_date,
  xi.sync_status,
  xi.payment_id,
  p.status as payment_status,
  p.payment_method,
  p.completed_at::date as payment_completed_date,
  xi.total_amount / 100.0 as total_dollars,
  xi.discount_amount / 100.0 as discount_dollars,
  xi.net_amount / 100.0 as net_dollars,
  u.email as user_email,
  u.first_name || ' ' || u.last_name as user_name,
  (xi.staging_metadata->'payment_items'->0->>'description') as description,
  EXTRACT(day FROM NOW() - xi.staged_at)::integer as days_stuck,
  -- Show as it appears on user detail page
  'PAY-' || SUBSTRING(p.id::text, 1, 8) as display_invoice_number
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id  -- Must have payment record
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'  -- Payment was completed
  AND xi.staged_at < '2025-10-22'  -- Before the fix
ORDER BY xi.staged_at DESC;

-- ============================================================================
-- SECTION 2: Count by User (Users with Stuck Completed Invoices)
-- ============================================================================
SELECT
  u.id as user_id,
  u.email,
  u.first_name || ' ' || u.last_name as user_name,
  COUNT(xi.id) as stuck_invoice_count,
  SUM(xi.total_amount) / 100.0 as total_amount_dollars,
  SUM(xi.discount_amount) / 100.0 as total_discount_dollars,
  SUM(xi.net_amount) / 100.0 as total_net_dollars,
  MIN(xi.staged_at)::date as earliest_stuck_date,
  MAX(xi.staged_at)::date as latest_stuck_date,
  -- Count zero-value vs non-zero
  SUM(CASE WHEN xi.net_amount = 0 THEN 1 ELSE 0 END) as zero_value_count,
  SUM(CASE WHEN xi.net_amount > 0 THEN 1 ELSE 0 END) as non_zero_count
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22'
GROUP BY u.id, u.email, u.first_name, u.last_name
ORDER BY stuck_invoice_count DESC, earliest_stuck_date ASC;

-- ============================================================================
-- SECTION 3: Breakdown by Date
-- ============================================================================
SELECT
  xi.staged_at::date as staged_date,
  COUNT(xi.id) as stuck_count,
  SUM(CASE WHEN xi.net_amount = 0 THEN 1 ELSE 0 END) as zero_value_count,
  SUM(CASE WHEN xi.net_amount > 0 THEN 1 ELSE 0 END) as non_zero_count,
  COUNT(DISTINCT xi.staging_metadata->>'user_id') as affected_users
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22'
GROUP BY xi.staged_at::date
ORDER BY staged_date DESC;

-- ============================================================================
-- SECTION 4: Stuck Invoices by Type
-- ============================================================================
SELECT
  CASE
    WHEN xi.staging_metadata->'payment_items'->0->>'description' LIKE 'Alternate:%' THEN 'Alternate Payment'
    WHEN xi.staging_metadata->'payment_items'->0->>'description' LIKE 'Registration:%' THEN 'Registration'
    WHEN xi.staging_metadata->'payment_items'->0->>'description' LIKE 'Membership:%' THEN 'Membership'
    ELSE 'Other'
  END as item_category,
  COUNT(*) as stuck_count,
  SUM(CASE WHEN xi.net_amount = 0 THEN 1 ELSE 0 END) as zero_value_count,
  SUM(CASE WHEN xi.net_amount > 0 THEN 1 ELSE 0 END) as non_zero_count,
  AVG(xi.net_amount) / 100.0 as avg_net_amount_dollars
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22'
GROUP BY item_category
ORDER BY stuck_count DESC;

-- ============================================================================
-- SECTION 5: Discount Usage Check
-- ============================================================================
-- Check if these stuck invoices have discount usage recorded
-- (This indicates they were definitely completed)
SELECT
  '=== STUCK INVOICES WITH DISCOUNT USAGE RECORDED ===' as section,
  xi.id as invoice_id,
  xi.staged_at::date as staged_date,
  u.email as user_email,
  (xi.staging_metadata->'payment_items'->0->>'description') as description,
  xi.discount_amount / 100.0 as discount_dollars,
  du.amount_saved / 100.0 as discount_usage_recorded_dollars,
  du.used_at::date as discount_used_date,
  dc.code as discount_code,
  dcat.name as discount_category
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
LEFT JOIN discount_usage du ON du.user_id = u.id
  AND du.used_at::date = xi.staged_at::date
LEFT JOIN discount_codes dc ON du.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22'
  AND xi.discount_amount > 0
ORDER BY xi.staged_at DESC;

-- ============================================================================
-- SECTION 6: Generate IDs for Bulk Update
-- ============================================================================
SELECT
  '=== INVOICE IDS FOR BULK UPDATE ===' as section,
  string_agg('''' || xi.id::text || '''', ',
  ') as invoice_ids_for_update
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22';

-- ============================================================================
-- SECTION 7: Generate Update Statement
-- ============================================================================
SELECT '-- ============================================================================
-- UPDATE STATEMENT TO FIX STUCK COMPLETED INVOICES
-- ============================================================================
-- This updates only invoices that have completed payments but are stuck
-- in ''staged'' status (NOT abandoned registrations)
--
-- Expected update count: ' || COUNT(*) || ' invoices
-- ============================================================================

UPDATE xero_invoices
SET sync_status = ''pending'',
    updated_at = NOW()
WHERE id IN (
  SELECT xi.id
  FROM xero_invoices xi
  INNER JOIN payments p ON xi.payment_id = p.id
  WHERE xi.sync_status = ''staged''
    AND p.status = ''completed''
    AND xi.staged_at < ''2025-10-22''
);

-- Verify the update:
SELECT
  id,
  staged_at,
  sync_status,
  payment_id,
  total_amount / 100.0 as total_dollars,
  discount_amount / 100.0 as discount_dollars
FROM xero_invoices
WHERE id IN (
  SELECT xi.id
  FROM xero_invoices xi
  INNER JOIN payments p ON xi.payment_id = p.id
  WHERE xi.sync_status = ''pending''
    AND p.status = ''completed''
    AND xi.staged_at < ''2025-10-22''
    AND xi.updated_at > NOW() - INTERVAL ''5 minutes''
)
ORDER BY staged_at DESC;' as fix_statement
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22';

-- ============================================================================
-- SECTION 8: Summary Statistics
-- ============================================================================
SELECT
  '=== SUMMARY ===' as section,
  COUNT(*) as total_stuck_completed_invoices,
  COUNT(DISTINCT xi.staging_metadata->>'user_id') as affected_users,
  SUM(CASE WHEN xi.net_amount = 0 THEN 1 ELSE 0 END) as zero_value_invoices,
  SUM(CASE WHEN xi.net_amount > 0 THEN 1 ELSE 0 END) as non_zero_invoices,
  SUM(xi.total_amount) / 100.0 as total_gross_dollars,
  SUM(xi.discount_amount) / 100.0 as total_discount_dollars,
  SUM(xi.net_amount) / 100.0 as total_net_dollars,
  MIN(xi.staged_at)::date as earliest_date,
  MAX(xi.staged_at)::date as latest_date
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22';

-- ============================================================================
-- SECTION 9: Expected vs Actual 'staged' Invoices
-- ============================================================================
-- This shows the difference between all staged (including abandoned) vs stuck
SELECT
  '=== COMPARISON: ALL STAGED VS STUCK COMPLETED ===' as section,
  (SELECT COUNT(*) FROM xero_invoices WHERE sync_status = 'staged') as total_staged_invoices,
  (SELECT COUNT(*)
   FROM xero_invoices xi
   INNER JOIN payments p ON xi.payment_id = p.id
   WHERE xi.sync_status = 'staged'
     AND p.status = 'completed'
     AND xi.staged_at < '2025-10-22') as stuck_completed_invoices,
  (SELECT COUNT(*) FROM xero_invoices WHERE sync_status = 'staged' AND payment_id IS NULL) as likely_abandoned_invoices;

-- ============================================================================
-- SECTION 10: Recent Stuck Invoices (After Oct 22 - Needs Investigation)
-- ============================================================================
-- These are invoices that were created AFTER the fix but are still stuck
-- This could indicate a new issue or edge case
SELECT
  '=== STUCK COMPLETED INVOICES AFTER OCT 22 (UNEXPECTED!) ===' as section,
  xi.id as invoice_id,
  xi.staged_at,
  xi.payment_id,
  p.status as payment_status,
  p.completed_at,
  xi.net_amount / 100.0 as net_dollars,
  u.email as user_email,
  (xi.staging_metadata->'payment_items'->0->>'description') as description,
  EXTRACT(hour FROM NOW() - xi.staged_at)::numeric(10,1) as hours_stuck
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at >= '2025-10-22'
ORDER BY xi.staged_at DESC;
