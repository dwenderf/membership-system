-- Migration: Fix credit note amounts in financial reports
-- Created: 2025-12-15
-- Issue: Credit notes show positive amounts instead of negative because view checks payment_status instead of invoice_type
-- This doesn't work for partial refunds where payment_status stays 'completed'

-- Drop dependent views
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS membership_reports_data CASCADE;
DROP VIEW IF EXISTS reports_financial_data CASCADE;

-- Recreate reports_financial_data with invoice_type included
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
    xi.invoice_type, -- Added invoice_type to identify credit notes
    xi.invoice_status,
    xi.sync_status,
    xi.created_at as invoice_created_at,
    xi.updated_at as invoice_updated_at,
    p.id as payment_id,
    p.status as payment_status,
    -- Show negative payment amount for refunded payments
    CASE
        WHEN p.status = 'refunded' THEN -p.final_amount
        ELSE p.final_amount
    END as payment_amount,
    p.created_at as payment_created_at,
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    -- Discount information
    dc.code as discount_code,
    dc.discount_category_id,
    dcat.name as discount_category_name,
    -- Computed fields for easier reporting
    CASE
        WHEN xil.line_item_type = 'discount' THEN ABS(xil.line_amount)
        ELSE xil.line_amount
    END as absolute_amount,
    -- Full customer name
    CONCAT(u.first_name, ' ', u.last_name) as customer_name,
    -- Total refunded amount for this payment
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

-- Set security invoker for RLS
ALTER VIEW reports_financial_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON reports_financial_data TO authenticated;

-- Recreate membership_reports_data view with proper credit note handling
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

-- Recreate registration_reports_data view with proper credit note handling
CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    -- For credit notes, ensure line amounts are negative (for revenue items)
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

-- Note: This migration changes the logic from checking payment_status to checking invoice_type
-- Credit notes (invoice_type = 'ACCRECCREDIT') will now always show negative amounts for revenue items
-- This correctly handles:
-- 1. Full refunds (payment_status = 'refunded')
-- 2. Partial refunds (payment_status = 'completed' but still a credit note)
-- 3. Zero-dollar refunds (payment_status may vary)
