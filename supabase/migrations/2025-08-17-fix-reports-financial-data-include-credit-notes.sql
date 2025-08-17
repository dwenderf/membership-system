-- Migration: Fix reports_financial_data view to include credit notes and improve payment amount handling
-- Created: 2025-08-17
-- Issue: Credit notes (refunds) were not appearing in financial reports due to payment status filtering

-- Drop the existing view
DROP VIEW IF EXISTS reports_financial_data CASCADE;

-- Recreate the view with simplified filtering and improved payment amount logic
CREATE VIEW reports_financial_data AS
SELECT
    xil.id as line_item_id,
    xil.line_amount,
    xil.quantity,
    xil.line_item_type,
    xil.description,
    xil.discount_code_id,
    xil.created_at as line_item_created_at,
    xi.id as invoice_id,
    xi.invoice_number,
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

-- Recreate dependent views that were dropped by CASCADE

-- Recreate membership_reports_data view
CREATE VIEW membership_reports_data AS
SELECT
    m.id as membership_id,
    m.name as membership_name,
    m.description as membership_description,
    rfd.customer_name,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    rfd.payment_amount,
    rfd.line_amount,
    rfd.line_item_id,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.payment_id,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
    -- Line amount (no need for absolute value since we only get membership line items)
    rfd.line_amount as absolute_amount
FROM reports_financial_data rfd
LEFT JOIN user_memberships um ON rfd.payment_id = um.payment_id 
RIGHT JOIN memberships m ON um.membership_id = m.id  
WHERE rfd.line_item_type = 'membership'
    AND rfd.payment_id IS NOT NULL; -- Ensure we only get actual membership purchases

-- Add RLS policy for the view (admin only)
ALTER VIEW membership_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON membership_reports_data TO authenticated; 

-- Recreate registration_reports_data view
CREATE VIEW registration_reports_data AS
SELECT
    rfd.*,
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

-- Add RLS policy for the view (admin only)
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON registration_reports_data TO authenticated;