-- Diagnostic Script: Identify credit notes with discount line items that may have incorrect discount_usage records
-- Run this to see which credit notes are affected before applying fixes

-- STEP 1: Find all synced credit notes with discount line items
-- These are the ones that would have created incorrect discount_usage records
SELECT
    xi.id as credit_note_id,
    xi.invoice_number,
    xi.created_at as credit_note_date,
    xi.payment_id,
    p.status as payment_status,
    u.first_name || ' ' || u.last_name as customer_name,
    u.email,
    xil.id as line_item_id,
    xil.description,
    xil.line_amount,
    xil.account_code,
    xil.line_item_type,
    xil.discount_code_id,
    dc.code as discount_code,
    dcat.name as discount_category
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
  AND xil.discount_code_id IS NOT NULL
ORDER BY xi.created_at DESC;

-- STEP 2: Show credit notes with multiple line items (the problematic ones)
-- These are full/partial refunds that include both revenue and discount reversals
SELECT
    xi.id as credit_note_id,
    xi.invoice_number,
    xi.created_at as credit_note_date,
    xi.total_amount,
    u.first_name || ' ' || u.last_name as customer_name,
    COUNT(xil.id) as line_item_count,
    COUNT(CASE WHEN xil.line_item_type = 'discount' THEN 1 END) as discount_line_count,
    COUNT(CASE WHEN xil.line_item_type = 'registration' THEN 1 END) as registration_line_count,
    STRING_AGG(DISTINCT xil.account_code, ', ') as account_codes_used
FROM xero_invoices xi
JOIN xero_invoice_line_items xil ON xil.xero_invoice_id = xi.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
GROUP BY xi.id, xi.invoice_number, xi.created_at, xi.total_amount, u.first_name, u.last_name
HAVING COUNT(xil.id) > 1
ORDER BY xi.created_at DESC;

-- STEP 3: Show the discount_usage records that are likely incorrect
-- These are records with POSITIVE amounts that were created from refund credit notes
-- (We can identify them because they share the same user_id, discount_code_id, and registration_id
-- with another positive record - meaning the original usage AND the "reversal" are both positive)
SELECT
    du.id as discount_usage_id,
    du.user_id,
    u.first_name || ' ' || u.last_name as customer_name,
    du.discount_code_id,
    dc.code as discount_code,
    du.amount_saved,
    du.used_at,
    du.registration_id,
    r.name as registration_name,
    du.season_id
FROM discount_usage du
JOIN users u ON du.user_id = u.id
JOIN discount_codes dc ON du.discount_code_id = dc.id
LEFT JOIN registrations r ON du.registration_id = r.id
WHERE du.amount_saved > 0
  AND EXISTS (
    -- Find users who have multiple positive records for the same discount code and registration
    SELECT 1 FROM discount_usage du2
    WHERE du2.user_id = du.user_id
      AND du2.discount_code_id = du.discount_code_id
      AND du2.registration_id = du.registration_id
      AND du2.amount_saved > 0
      AND du2.id != du.id
  )
ORDER BY du.user_id, du.discount_code_id, du.used_at;

-- STEP 4: List unique account codes used in discount line items within credit notes
-- This helps identify which accounting codes need attention in Xero
SELECT DISTINCT
    xil.account_code,
    dcat.name as discount_category,
    COUNT(*) as usage_count
FROM xero_invoice_line_items xil
JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
WHERE xi.invoice_type = 'ACCRECCREDIT'
  AND xi.sync_status = 'synced'
  AND xil.line_item_type = 'discount'
GROUP BY xil.account_code, dcat.name
ORDER BY usage_count DESC;
