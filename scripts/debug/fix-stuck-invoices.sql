-- ============================================================================
-- FIX SCRIPT: Update Stuck Completed Invoices from 'staged' to 'pending'
-- ============================================================================
-- WARNING: Only run this AFTER reviewing the diagnostic script results!
--
-- This script updates invoices that:
-- 1. Have sync_status = 'staged'
-- 2. Have a completed payment (payment.status = 'completed')
-- 3. Were created before Oct 22, 2025 (before the bug fix)
--
-- After running this, the Xero cron job (runs every 5 minutes) will
-- automatically pick them up and sync them to Xero.
-- ============================================================================

-- STEP 1: Show what will be updated (DRY RUN)
SELECT
  '=== DRY RUN: INVOICES THAT WILL BE UPDATED ===' as step,
  xi.id as invoice_id,
  xi.staged_at::date as staged_date,
  xi.sync_status as current_status,
  'pending' as new_status,
  u.email as user_email,
  xi.net_amount / 100.0 as net_dollars,
  (xi.staging_metadata->'payment_items'->0->>'description') as description
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON (xi.staging_metadata->>'user_id')::uuid = u.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22'
ORDER BY xi.staged_at DESC;

-- STEP 2: Count how many will be updated
SELECT
  '=== COUNT OF INVOICES TO UPDATE ===' as step,
  COUNT(*) as invoices_to_update
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22';

-- ============================================================================
-- STEP 3: ACTUAL UPDATE
-- ============================================================================
-- Uncomment the lines below to execute the update
-- Only run this after reviewing the dry run results above!
-- ============================================================================

/*
BEGIN;

UPDATE xero_invoices
SET sync_status = 'pending',
    updated_at = NOW()
WHERE id IN (
  SELECT xi.id
  FROM xero_invoices xi
  INNER JOIN payments p ON xi.payment_id = p.id
  WHERE xi.sync_status = 'staged'
    AND p.status = 'completed'
    AND xi.staged_at < '2025-10-22'
);

-- Show what was updated
SELECT
  '=== UPDATED INVOICES ===' as result,
  id,
  staged_at::date as staged_date,
  sync_status,
  updated_at,
  (staging_metadata->>'user_id')::uuid as user_id
FROM xero_invoices
WHERE sync_status = 'pending'
  AND updated_at > NOW() - INTERVAL '1 minute'
ORDER BY staged_at DESC;

COMMIT;
*/

-- ============================================================================
-- STEP 4: VERIFICATION QUERIES (Run after update)
-- ============================================================================

-- Verify the updates were successful
SELECT
  '=== VERIFICATION: Recently Updated to Pending ===' as step,
  COUNT(*) as recently_updated_count
FROM xero_invoices
WHERE sync_status = 'pending'
  AND updated_at > NOW() - INTERVAL '5 minutes';

-- Check if any stuck invoices remain
SELECT
  '=== VERIFICATION: Remaining Stuck Invoices ===' as step,
  COUNT(*) as remaining_stuck_count
FROM xero_invoices xi
INNER JOIN payments p ON xi.payment_id = p.id
WHERE xi.sync_status = 'staged'
  AND p.status = 'completed'
  AND xi.staged_at < '2025-10-22';

-- Monitor sync progress (run this after 5-10 minutes)
SELECT
  '=== SYNC PROGRESS MONITOR ===' as step,
  sync_status,
  COUNT(*) as count
FROM xero_invoices
WHERE updated_at > NOW() - INTERVAL '15 minutes'
GROUP BY sync_status
ORDER BY sync_status;
