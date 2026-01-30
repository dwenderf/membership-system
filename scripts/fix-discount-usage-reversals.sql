-- Fix Script: Correct discount_usage records that were incorrectly recorded as positive for refunds
--
-- IMPORTANT: Run the diagnostic script first (diagnose-discount-reversals.sql) to see what will be affected
--
-- This script identifies discount_usage records that were created from credit note processing
-- and should have been negative (reversals) but were recorded as positive.

-- The logic:
-- 1. Find credit notes (ACCRECCREDIT) with discount line items that have positive amounts
-- 2. These positive amounts in credit notes represent REVERSALS of original discounts
-- 3. The discount_usage records created from these should be negative, not positive
-- 4. We'll insert correcting negative records to offset the incorrect positive ones

BEGIN;

-- First, let's see what we're about to fix (DRY RUN)
-- This shows the credit note discount line items and any matching discount_usage records
SELECT
    'PREVIEW' as action,
    xi.invoice_number as credit_note_number,
    xi.created_at as credit_note_date,
    u.id as user_id,
    u.first_name || ' ' || u.last_name as customer_name,
    xil.discount_code_id,
    dc.code as discount_code,
    xil.line_amount as credit_note_line_amount,
    du.id as discount_usage_id,
    du.amount_saved as current_amount_saved,
    -ABS(xil.line_amount) as should_be_amount,
    CASE
        WHEN du.amount_saved > 0 AND xil.line_amount > 0 THEN 'NEEDS FIX: positive reversal should be negative'
        WHEN du.amount_saved < 0 THEN 'OK: already negative'
        ELSE 'UNKNOWN'
    END as status
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
JOIN payments p ON xi.payment_id = p.id
JOIN users u ON p.user_id = u.id
JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_usage du ON (
    du.user_id = u.id
    AND du.discount_code_id = xil.discount_code_id
    AND du.amount_saved > 0
    AND du.used_at >= xi.created_at - INTERVAL '1 minute'
    AND du.used_at <= xi.created_at + INTERVAL '1 minute'
)
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
  AND xil.line_amount > 0  -- Positive discount in credit note = reversal
ORDER BY xi.created_at DESC;

-- OPTION A: Insert correcting negative records
-- This adds a negative record to offset each incorrect positive record
-- Advantage: Maintains audit trail of what happened
--
-- Uncomment and run this section to apply the fix:

/*
INSERT INTO discount_usage (
    user_id,
    discount_code_id,
    discount_category_id,
    season_id,
    amount_saved,
    registration_id,
    used_at
)
SELECT DISTINCT
    u.id as user_id,
    xil.discount_code_id,
    dc.discount_category_id,
    ur.season_id,
    -ABS(xil.line_amount) as amount_saved,  -- NEGATIVE to offset the incorrect positive
    ur.registration_id,
    NOW() as used_at  -- Use current time for the correction
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
JOIN payments p ON xi.payment_id = p.id
JOIN users u ON p.user_id = u.id
JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN user_registrations ur ON ur.payment_id = p.id
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
  AND xil.line_amount > 0  -- Positive discount in credit note = reversal
  -- Only fix records that don't already have a negative correction
  AND NOT EXISTS (
    SELECT 1 FROM discount_usage du_check
    WHERE du_check.user_id = u.id
      AND du_check.discount_code_id = xil.discount_code_id
      AND du_check.amount_saved < 0
      AND du_check.used_at >= xi.created_at - INTERVAL '1 day'
  );
*/

-- OPTION B: Update existing incorrect records to be negative
-- This directly changes the incorrect positive records to negative
-- Advantage: Cleaner data, but loses some audit trail
--
-- Uncomment and run this section to apply the fix:

/*
UPDATE discount_usage du
SET amount_saved = -ABS(du.amount_saved)
WHERE du.id IN (
    SELECT du_inner.id
    FROM discount_usage du_inner
    JOIN users u ON du_inner.user_id = u.id
    JOIN payments p ON p.user_id = u.id
    JOIN xero_invoices xi ON xi.payment_id = p.id
    JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
    WHERE xi.invoice_type = 'ACCRECCREDIT'
      AND xi.sync_status = 'synced'
      AND xil.line_item_type = 'discount'
      AND xil.discount_code_id = du_inner.discount_code_id
      AND xil.line_amount > 0  -- Positive discount in credit note = reversal
      AND du_inner.amount_saved > 0  -- Currently incorrect positive
      AND du_inner.used_at >= xi.created_at - INTERVAL '1 minute'
      AND du_inner.used_at <= xi.created_at + INTERVAL '1 minute'
);
*/

-- After running the fix, verify with:
-- SELECT * FROM discount_usage WHERE amount_saved < 0 ORDER BY used_at DESC;

ROLLBACK;  -- Change to COMMIT after reviewing the preview and uncommenting your chosen fix option
