-- Fix Script: Correct discount_usage records for refund credit notes
-- This handles BOTH scenarios:
-- 1. Zero-dollar refunds: Positive credit note amounts with WRONG positive discount_usage
-- 2. Proportional refunds: Negative credit note amounts with NO discount_usage record
--
-- Run diagnose-discount-reversals.sql first to see what will be affected

BEGIN;

-- PREVIEW: Show all affected credit notes and what needs to be fixed
SELECT
    'PREVIEW' as action,
    xi.invoice_number as credit_note_number,
    xi.created_at as credit_note_date,
    u.id as user_id,
    u.first_name || ' ' || u.last_name as customer_name,
    xil.discount_code_id,
    dc.code as discount_code,
    xil.line_amount as credit_note_line_amount,
    du.id as existing_discount_usage_id,
    du.amount_saved as existing_amount_saved,
    -- What we need: always negative for reversals
    CASE
        WHEN xil.line_amount > 0 THEN -xil.line_amount  -- Positive in credit note → negate
        ELSE xil.line_amount                              -- Negative in credit note → keep
    END as correct_amount,
    -- What action is needed
    CASE
        WHEN du.id IS NOT NULL AND du.amount_saved > 0
            THEN 'NEEDS FIX: Update existing positive to negative OR insert offsetting negative'
        WHEN du.id IS NULL
            THEN 'NEEDS FIX: Insert missing negative discount_usage record'
        WHEN du.amount_saved < 0
            THEN 'OK: Already has negative discount_usage'
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
    -- Match by approximate time (within 5 minutes of credit note creation)
    AND du.used_at >= xi.created_at - INTERVAL '5 minutes'
    AND du.used_at <= xi.created_at + INTERVAL '5 minutes'
)
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
ORDER BY xi.created_at DESC;

-- =============================================================================
-- FIX OPTION A: Insert negative records to offset incorrect positives
--               AND insert missing records for proportional refunds
-- =============================================================================
-- This is the RECOMMENDED approach - maintains audit trail

/*
-- Insert correcting/missing negative discount_usage records
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
    COALESCE(ur.season_id, s.id) as season_id,
    -- Always insert negative amount to reverse/record the refund
    CASE
        WHEN xil.line_amount > 0 THEN -xil.line_amount  -- Positive → negate
        ELSE xil.line_amount                              -- Negative → keep
    END as amount_saved,
    ur.registration_id,
    xi.created_at as used_at  -- Use credit note timestamp
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
JOIN payments p ON xi.payment_id = p.id
JOIN users u ON p.user_id = u.id
JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN user_registrations ur ON ur.payment_id = p.id
LEFT JOIN registrations r ON ur.registration_id = r.id
LEFT JOIN seasons s ON r.season_id = s.id
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
  -- Only fix records that need fixing:
  -- 1. No existing discount_usage for this refund, OR
  -- 2. Existing discount_usage has wrong positive amount
  AND NOT EXISTS (
    SELECT 1 FROM discount_usage du_existing
    WHERE du_existing.user_id = u.id
      AND du_existing.discount_code_id = xil.discount_code_id
      AND du_existing.amount_saved < 0  -- Already has a negative correction
      AND du_existing.used_at >= xi.created_at - INTERVAL '1 day'
      AND du_existing.used_at <= xi.created_at + INTERVAL '1 day'
  );
*/

-- =============================================================================
-- FIX OPTION B: Update existing incorrect positive records to be negative
-- =============================================================================
-- Only use this if you want to modify existing records instead of adding new ones
-- Note: This won't help for proportional refunds that have NO discount_usage record

/*
UPDATE discount_usage
SET amount_saved = -ABS(amount_saved)
WHERE id IN (
    SELECT du.id
    FROM discount_usage du
    JOIN users u ON du.user_id = u.id
    JOIN discount_codes dc ON du.discount_code_id = dc.id
    WHERE du.amount_saved > 0  -- Only fix positive records
      AND EXISTS (
        -- Verify this corresponds to a credit note (refund)
        SELECT 1
        FROM xero_invoices xi
        JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
        JOIN payments p ON xi.payment_id = p.id
        WHERE p.user_id = du.user_id
          AND xil.discount_code_id = du.discount_code_id
          AND xi.invoice_type = 'ACCRECCREDIT'
          AND xi.sync_status = 'synced'
          AND du.used_at >= xi.created_at - INTERVAL '5 minutes'
          AND du.used_at <= xi.created_at + INTERVAL '5 minutes'
      )
);
*/

-- =============================================================================
-- VERIFICATION: Check discount usage totals by user after fix
-- =============================================================================
/*
SELECT
    u.first_name || ' ' || u.last_name as customer_name,
    dc.code as discount_code,
    dcat.name as category,
    SUM(du.amount_saved) as total_usage,
    COUNT(*) as record_count,
    SUM(CASE WHEN du.amount_saved > 0 THEN du.amount_saved ELSE 0 END) as positive_sum,
    SUM(CASE WHEN du.amount_saved < 0 THEN du.amount_saved ELSE 0 END) as negative_sum
FROM discount_usage du
JOIN users u ON du.user_id = u.id
JOIN discount_codes dc ON du.discount_code_id = dc.id
JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
GROUP BY u.id, u.first_name, u.last_name, dc.code, dcat.name
HAVING COUNT(*) > 1
ORDER BY u.last_name, u.first_name, dc.code;
*/

ROLLBACK;  -- Change to COMMIT after reviewing and uncommenting your chosen fix
