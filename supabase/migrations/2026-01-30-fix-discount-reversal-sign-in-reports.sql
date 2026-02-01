-- Migration: Fix discount reversal sign in reports
-- Created: 2026-01-30
-- Issue: Discount reversals in credit notes show as positive instead of negative
-- This causes discount usage to be double-counted instead of netted to zero
--
-- The problem:
-- - Original invoice discount: -$620 (shown as +$620 absolute_amount in reports = "used $620")
-- - Credit note discount: +$620 (was showing as +$620 absolute_amount = "used $620 again")
-- - Total shown: $1,240 instead of $0
--
-- The fix:
-- - Credit note discount absolute_amount should be NEGATIVE to offset the original
-- - Original: +$620, Credit note: -$620, Net: $0

-- Drop dependent views in correct order
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS membership_reports_data CASCADE;

-- Recreate membership_reports_data (unchanged from previous migration)
CREATE VIEW membership_reports_data AS
SELECT
    m.id as membership_id,
    m.name as membership_name,
    m.description as membership_description,
    rfd.customer_name,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    -- For credit notes, negate the payment amount
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -rfd.payment_amount
        ELSE rfd.payment_amount
    END as payment_amount,
    -- For credit notes, ensure line amounts are negative (for revenue items)
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
    -- For credit notes, negate the absolute amount
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.absolute_amount)
        ELSE rfd.absolute_amount
    END as absolute_amount
FROM reports_financial_data rfd
LEFT JOIN user_memberships um ON rfd.payment_id = um.payment_id
RIGHT JOIN memberships m ON um.membership_id = m.id
WHERE rfd.line_item_type = 'membership'
    AND rfd.payment_id IS NOT NULL;

-- Recreate registration_reports_data with FIXED discount sign handling
-- KEY FIX: Discount absolute_amount in credit notes should be NEGATIVE
-- to properly offset the original positive discount usage
CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    -- line_amount handling (used for accounting display):
    -- - Registration/revenue items: Original positive, credit note negative
    -- - Discount items: Original negative, credit note positive (shows the reversal)
    CASE
        -- For discount line items in credit notes: make POSITIVE (reverses original negative)
        WHEN rfd.invoice_type = 'ACCRECCREDIT' AND rfd.line_item_type = 'discount' THEN ABS(rfd.line_amount)
        -- For revenue line items in credit notes: make NEGATIVE (reverses original positive)
        WHEN rfd.invoice_type = 'ACCRECCREDIT' AND rfd.line_item_type != 'discount' THEN -ABS(rfd.line_amount)
        -- For original invoices: keep as-is
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
    -- For credit notes, negate the payment amount
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
    -- absolute_amount handling (used for discount usage reporting/totals):
    -- FIX: ALL credit note items should have NEGATIVE absolute_amount
    -- This ensures:
    -- - Original discount: +$620 (amount saved)
    -- - Credit note discount reversal: -$620 (reversal of amount saved)
    -- - Net: $0 (correct total after refund)
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.absolute_amount)
        ELSE rfd.absolute_amount
    END as absolute_amount,
    rfd.customer_name,
    rfd.total_refunded,
    r.id as registration_id,
    r.name as registration_name,
    r.type as registration_type,
    rc.id as registration_category_id,
    rc.custom_name as registration_category_name,
    rc.price as registration_category_price,
    c.name as category_name,
    s.id as season_id,
    s.name as season_name
FROM reports_financial_data rfd
LEFT JOIN user_registrations ur ON rfd.payment_id = ur.payment_id
LEFT JOIN registrations r ON ur.registration_id = r.id
LEFT JOIN registration_categories rc ON ur.registration_category_id = rc.id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN seasons s ON r.season_id = s.id
WHERE rfd.line_item_type = 'registration';

-- Set security invoker for RLS on all views
ALTER VIEW membership_reports_data SET (security_invoker = true);
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the views
GRANT SELECT ON membership_reports_data TO authenticated;
GRANT SELECT ON registration_reports_data TO authenticated;

-- Summary of changes:
-- 1. In registration_reports_data, changed absolute_amount for credit note discounts
--    from ABS(rfd.absolute_amount) to -ABS(rfd.absolute_amount)
-- 2. This makes discount reversals show as negative values in reports
-- 3. When summed with original positive values, refunded discounts now net to $0
