-- Migration: Fix registration_reports_data to exclude discount line items
-- Created: 2026-01-30
-- Issue: Discount line items were appearing in the Registrations section of financial reports
-- because the view included both 'registration' AND 'discount' line_item_types.
-- The discount data should only come from the separate reports_financial_data query.

-- Drop and recreate registration_reports_data with correct filter
DROP VIEW IF EXISTS registration_reports_data CASCADE;

CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    -- line_amount handling (used for accounting display):
    -- - Registration/revenue items: Original positive, credit note negative
    CASE
        -- For revenue line items in credit notes: make NEGATIVE (reverses original positive)
        WHEN rfd.invoice_type = 'ACCRECCREDIT' THEN -ABS(rfd.line_amount)
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
    -- For credit notes, negate the absolute amount
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
WHERE rfd.line_item_type = 'registration';  -- FIXED: Only registration items, not discounts

-- Set security invoker for RLS
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON registration_reports_data TO authenticated;
