-- Migration: Fix discount absolute_amount in reports_financial_data for credit notes
-- Created: 2026-01-30
-- Issue: Credit note discount line items show positive absolute_amount, causing refunds
-- to be counted as additional usage instead of offsetting original usage.
--
-- Example: User uses $30 discount, then refunds:
-- - Original invoice discount: ABS(-3000) = +3000 ($30 usage)
-- - Credit note discount: ABS(+3000) = +3000 ($30 usage) <- WRONG!
-- - Total: $60 (should be $0)
--
-- Fix: Credit note discounts should have NEGATIVE absolute_amount
-- - Original invoice discount: ABS(-3000) = +3000 ($30 usage)
-- - Credit note discount: -ABS(+3000) = -3000 (-$30 reversal)
-- - Total: $0 (correct)

-- Drop dependent views first
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS membership_reports_data CASCADE;
DROP VIEW IF EXISTS reports_financial_data CASCADE;

-- Recreate reports_financial_data with fixed absolute_amount for credit note discounts
CREATE VIEW reports_financial_data AS
SELECT
    xil.id as line_item_id,
    xil.line_amount,
    xil.quantity,
    xil.line_item_type,
    xil.description,
    xil.discount_code_id,
    xil.item_id,
    xil.created_at as line_item_created_at,
    xi.id as invoice_id,
    xi.invoice_number,
    xi.invoice_type,
    xi.invoice_status,
    xi.sync_status,
    xi.created_at as invoice_created_at,
    xi.updated_at as invoice_updated_at,
    p.id as payment_id,
    p.status as payment_status,
    CASE
        WHEN p.status = 'refunded' THEN -p.final_amount
        ELSE p.final_amount
    END as payment_amount,
    p.created_at as payment_created_at,
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    dc.code as discount_code,
    dc.discount_category_id,
    dcat.name as discount_category_name,
    -- FIX: Credit note discounts should be NEGATIVE to offset original usage
    CASE
        WHEN xi.invoice_type = 'ACCRECCREDIT' AND xil.line_item_type = 'discount' THEN -ABS(xil.line_amount)
        WHEN xil.line_item_type = 'discount' THEN ABS(xil.line_amount)
        ELSE xil.line_amount
    END as absolute_amount,
    CONCAT(u.first_name, ' ', u.last_name) as customer_name,
    COALESCE(
        (SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id = p.id AND r.status = 'completed'),
        0
    ) AS total_refunded
FROM xero_invoice_line_items xil
INNER JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
WHERE xi.sync_status IN ('synced', 'pending')
    AND xi.invoice_status != 'DRAFT'
ORDER BY xi.created_at DESC;

ALTER VIEW reports_financial_data SET (security_invoker = true);
GRANT SELECT ON reports_financial_data TO authenticated;

-- Recreate membership_reports_data (depends on reports_financial_data)
CREATE VIEW membership_reports_data AS
SELECT
    m.id as membership_id,
    m.name as membership_name,
    m.description as membership_description,
    rfd.customer_name,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -rfd.payment_amount
        ELSE rfd.payment_amount
    END as payment_amount,
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.line_amount)
        ELSE rfd.line_amount
    END as line_amount,
    rfd.line_item_id,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.invoice_type,
    rfd.payment_id,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.absolute_amount)
        ELSE rfd.absolute_amount
    END as absolute_amount
FROM reports_financial_data rfd
LEFT JOIN user_memberships um ON rfd.payment_id = um.payment_id
RIGHT JOIN memberships m ON um.membership_id = m.id
WHERE rfd.line_item_type = 'membership'
    AND rfd.payment_id IS NOT NULL;

ALTER VIEW membership_reports_data SET (security_invoker = true);
GRANT SELECT ON membership_reports_data TO authenticated;

-- Recreate registration_reports_data (depends on reports_financial_data)
CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.line_amount)
        ELSE rfd.line_amount
    END as line_amount,
    rfd.quantity,
    rfd.line_item_type,
    rfd.description,
    rfd.discount_code_id,
    rfd.item_id,
    rfd.line_item_created_at,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.invoice_type,
    rfd.invoice_status,
    rfd.sync_status,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    rfd.payment_id,
    rfd.payment_status,
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -rfd.payment_amount
        ELSE rfd.payment_amount
    END as payment_amount,
    rfd.payment_created_at,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
    rfd.discount_code,
    rfd.discount_category_id,
    rfd.discount_category_name,
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.absolute_amount)
        ELSE rfd.absolute_amount
    END as absolute_amount,
    rfd.customer_name,
    rfd.total_refunded,
    COALESCE(r.id, r2.id) as registration_id,
    COALESCE(r.name, r2.name) as registration_name,
    COALESCE(r.type, r2.type) as registration_type,
    rc.id as registration_category_id,
    CASE
        WHEN ur.id IS NULL AND r2.id IS NOT NULL THEN 'Alternate'
        ELSE rc.custom_name
    END as registration_category_name,
    rc.price as registration_category_price,
    CASE
        WHEN ur.id IS NULL AND r2.id IS NOT NULL THEN 'Alternate'
        ELSE c.name
    END as category_name,
    COALESCE(s.id, s2.id) as season_id,
    COALESCE(s.name, s2.name) as season_name
FROM reports_financial_data rfd
LEFT JOIN user_registrations ur ON rfd.payment_id = ur.payment_id
LEFT JOIN registrations r ON ur.registration_id = r.id
LEFT JOIN registration_categories rc ON ur.registration_category_id = rc.id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN seasons s ON r.season_id = s.id
LEFT JOIN registrations r2 ON rfd.item_id = r2.id AND rfd.line_item_type = 'registration' AND ur.id IS NULL
LEFT JOIN seasons s2 ON r2.season_id = s2.id
WHERE rfd.line_item_type = 'registration';

ALTER VIEW registration_reports_data SET (security_invoker = true);
GRANT SELECT ON registration_reports_data TO authenticated;

COMMENT ON VIEW registration_reports_data IS 'Registration financial data with fallback to item_id for alternates that do not have user_registrations entries';
