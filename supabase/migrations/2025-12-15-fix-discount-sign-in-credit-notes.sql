-- Migration: Fix discount line item signs in credit notes
-- Created: 2025-12-15
-- Issue: Discount refunds showing as negative instead of positive
-- Discounts have opposite sign logic from revenue items:
-- - Original invoice discount: negative (cost to business)
-- - Credit note discount: positive (reduces cost to business)

-- Drop dependent views
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS membership_reports_data CASCADE;

-- Recreate membership_reports_data with correct sign handling
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

-- Recreate registration_reports_data with correct sign handling for different line item types
CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    -- Different sign logic for different line item types:
    -- - Registration/revenue items: Original positive, credit note negative
    -- - Discount items: Original negative, credit note positive (opposite!)
    CASE
        -- For discount line items in credit notes: make POSITIVE (original is negative)
        WHEN rfd.invoice_type = 'ACCRECCREDIT' AND rfd.line_item_type = 'discount' THEN ABS(rfd.line_amount)
        -- For revenue line items in credit notes: make NEGATIVE (original is positive)
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
    -- Different sign logic for absolute_amount:
    -- - Discount line items in credit notes: positive (gives back discount capacity)
    -- - Revenue line items in credit notes: negative (refund reduces revenue)
    CASE
        WHEN rfd.invoice_type = 'ACCRECCREDIT' AND rfd.line_item_type = 'discount' THEN ABS(rfd.absolute_amount)
        WHEN rfd.invoice_type = 'ACCRECCREDIT' AND rfd.line_item_type != 'discount' THEN -ABS(rfd.absolute_amount)
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
WHERE rfd.line_item_type IN ('registration', 'discount');

-- Set security invoker for RLS on all views
ALTER VIEW membership_reports_data SET (security_invoker = true);
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the views
GRANT SELECT ON membership_reports_data TO authenticated;
GRANT SELECT ON registration_reports_data TO authenticated;

-- Note: This migration fixes discount signs for credit notes
-- For discounts (expenses):
-- - Original invoice: negative (cost to business)
-- - Credit note: positive (reduces cost to business)
-- For revenue items:
-- - Original invoice: positive (revenue)
-- - Credit note: negative (refund reduces revenue)
