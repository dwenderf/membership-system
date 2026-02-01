-- Migration: Fix registration_reports_data view
-- Created: 2026-01-30
--
-- Fixes:
-- 1. Exclude discount line items (they should only appear in Discount Usage section)
-- 2. Restore alternate registration handling via item_id fallback (was lost in previous migration)
-- 3. Proper credit note sign handling for refunds

-- Drop and recreate registration_reports_data with all fixes
DROP VIEW IF EXISTS registration_reports_data CASCADE;

CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    -- line_amount handling for credit notes:
    -- Credit notes (ACCRECCREDIT) should show negative amounts to offset original positive
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
    -- Use COALESCE to fall back to item_id when user_registrations is NULL (alternates case)
    COALESCE(r.id, r2.id) as registration_id,
    COALESCE(r.name, r2.name) as registration_name,
    COALESCE(r.type, r2.type) as registration_type,
    rc.id as registration_category_id,
    -- Show "Alternate" for category name when this is an alternate (no user_registrations entry)
    CASE
        WHEN ur.id IS NULL AND r2.id IS NOT NULL THEN 'Alternate'
        ELSE rc.custom_name
    END as registration_category_name,
    rc.price as registration_category_price,
    -- Show "Alternate" for category name when this is an alternate
    CASE
        WHEN ur.id IS NULL AND r2.id IS NOT NULL THEN 'Alternate'
        ELSE c.name
    END as category_name,
    COALESCE(s.id, s2.id) as season_id,
    COALESCE(s.name, s2.name) as season_name
FROM reports_financial_data rfd
-- Primary path: regular registrations through user_registrations
LEFT JOIN user_registrations ur ON rfd.payment_id = ur.payment_id
LEFT JOIN registrations r ON ur.registration_id = r.id
LEFT JOIN registration_categories rc ON ur.registration_category_id = rc.id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN seasons s ON r.season_id = s.id
-- Fallback path: alternates through item_id (when user_registrations is NULL)
LEFT JOIN registrations r2 ON rfd.item_id = r2.id AND rfd.line_item_type = 'registration' AND ur.id IS NULL
LEFT JOIN seasons s2 ON r2.season_id = s2.id
WHERE rfd.line_item_type = 'registration';  -- Only registration items, not discounts

-- Set security invoker for RLS
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON registration_reports_data TO authenticated;

-- Add helpful comment
COMMENT ON VIEW registration_reports_data IS 'Registration financial data with fallback to item_id for alternates that do not have user_registrations entries';
