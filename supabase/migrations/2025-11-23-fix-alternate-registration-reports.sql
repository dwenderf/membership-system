-- Fix registration reports to properly handle alternate selections
-- This migration updates views to use xero_invoice_line_items.item_id as a fallback
-- for finding registration information when user_registrations is NULL (alternates case)

-- Step 1: Update reports_financial_data view to include item_id
DROP VIEW IF EXISTS registration_reports_data;
DROP VIEW IF EXISTS reports_financial_data;

CREATE VIEW reports_financial_data AS
SELECT
    xil.id as line_item_id,
    xil.line_amount,
    xil.quantity,
    xil.line_item_type,
    xil.description,
    xil.item_id, -- Add this for alternate registration lookup
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
    p.final_amount as payment_amount,
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
    CONCAT(u.first_name, ' ', u.last_name) as customer_name
FROM xero_invoice_line_items xil
INNER JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
WHERE xi.sync_status = 'synced'
  AND xi.invoice_status != 'DRAFT'
  AND p.status = 'completed';

-- Add RLS policy for the view (admin only)
ALTER VIEW reports_financial_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON reports_financial_data TO authenticated;

-- Step 2: Update registration_reports_data view to use item_id as fallback
CREATE VIEW registration_reports_data AS
SELECT
    rfd.*,
    -- Use COALESCE to fall back to item_id when user_registrations is NULL (alternates case)
    COALESCE(r.id, rfd.item_id) as registration_id,
    COALESCE(r.name, r2.name) as registration_name,
    COALESCE(r.type, r2.type) as registration_type,
    rc.id as registration_category_id,
    rc.custom_name as registration_category_name,
    rc.price as registration_category_price,
    c.name as category_name,
    COALESCE(s.id, s2.id) as season_id,
    COALESCE(s.name, s2.name) as season_name
FROM reports_financial_data rfd
-- Primary path: regular registrations through user_registrations
LEFT JOIN user_registrations ur ON rfd.payment_id = ur.payment_id
LEFT JOIN registrations r ON ur.registration_id = r.id
LEFT JOIN registration_categories rc ON ur.registration_category_id = rc.id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN seasons s ON r.season_id = s.id
-- Fallback path: alternates through item_id
LEFT JOIN registrations r2 ON rfd.item_id = r2.id AND rfd.line_item_type = 'registration' AND ur.id IS NULL
LEFT JOIN seasons s2 ON r2.season_id = s2.id
WHERE rfd.line_item_type = 'registration';

-- Add RLS policy for the view (admin only)
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON registration_reports_data TO authenticated;

-- Add helpful comment
COMMENT ON VIEW registration_reports_data IS 'Registration financial data with fallback to item_id for alternates that do not have user_registrations entries';
