-- Fix registration reports to properly handle alternate selections
-- This migration updates views to use xero_invoice_line_items.item_id as a fallback
-- for finding registration information when user_registrations is NULL (alternates case)

-- Step 1: Drop all dependent views first
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS membership_reports_data CASCADE;
DROP VIEW IF EXISTS recent_transactions CASCADE;

-- Step 2: Update reports_financial_data view to include item_id
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
WHERE xi.sync_status = 'synced'
  AND xi.invoice_status != 'DRAFT'
  AND p.status = 'completed';

-- Add RLS policy for the view (admin only)
ALTER VIEW reports_financial_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON reports_financial_data TO authenticated;

-- Step 3: Recreate recent_transactions view (unchanged but needs to be recreated)
CREATE VIEW recent_transactions AS
SELECT
    xi.id as transaction_id,
    xi.invoice_number,
    CASE
        -- For credit notes (refunds), show negative amounts
        WHEN xi.invoice_type = 'ACCRECCREDIT' THEN -xi.net_amount
        ELSE xi.net_amount
    END as amount,
    xi.invoice_status as status,
    xi.created_at as transaction_date,
    xi.staging_metadata,
    p.id as payment_id,
    p.final_amount as payment_amount,
    p.created_at as payment_date,
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    -- Use item_type from xero_invoice_line_items to determine transaction type
    COALESCE(
        (SELECT xili.line_item_type
         FROM xero_invoice_line_items xili
         WHERE xili.xero_invoice_id = xi.id
         LIMIT 1),
        CASE
            WHEN xi.invoice_type = 'ACCRECCREDIT' THEN 'credit_note'
            ELSE 'unknown'
        END
    ) as transaction_type,
    -- Get the actual item ID from line items
    (SELECT xili.item_id
     FROM xero_invoice_line_items xili
     WHERE xili.xero_invoice_id = xi.id
     LIMIT 1) as item_id,
    -- Add invoice type to differentiate credit notes
    xi.invoice_type
FROM xero_invoices xi
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
WHERE xi.payment_id IS NOT NULL
    AND xi.sync_status IN ('synced', 'pending')
    AND xi.invoice_status != 'DRAFT'
    -- Include both regular invoices with completed payments and all credit notes
    AND (
        (xi.invoice_type = 'ACCREC' AND p.status = 'completed') OR
        (xi.invoice_type = 'ACCRECCREDIT')
    )
ORDER BY xi.created_at DESC;

ALTER VIEW recent_transactions SET (security_invoker = true);
GRANT SELECT ON recent_transactions TO authenticated;

-- Step 4: Recreate membership_reports_data view (unchanged but needs to be recreated)
CREATE VIEW membership_reports_data AS
SELECT
    m.id as membership_id,
    m.name as membership_name,
    m.description as membership_description,
    rfd.customer_name,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    -- Show negative payment amount for refunded payments
    CASE
        WHEN rfd.payment_status = 'refunded' THEN -rfd.payment_amount
        ELSE rfd.payment_amount
    END as payment_amount,
    -- Show negative line amount for refunded payments
    CASE
        WHEN rfd.payment_status = 'refunded' THEN -rfd.line_amount
        ELSE rfd.line_amount
    END as line_amount,
    rfd.line_item_id,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.payment_id,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
    -- Show negative absolute amount for refunded payments
    CASE
        WHEN rfd.payment_status = 'refunded' THEN -rfd.absolute_amount
        ELSE rfd.absolute_amount
    END as absolute_amount
FROM reports_financial_data rfd
LEFT JOIN user_memberships um ON rfd.payment_id = um.payment_id
RIGHT JOIN memberships m ON um.membership_id = m.id
WHERE rfd.line_item_type = 'membership'
    AND rfd.payment_id IS NOT NULL;

ALTER VIEW membership_reports_data SET (security_invoker = true);
GRANT SELECT ON membership_reports_data TO authenticated;

-- Step 5: Update registration_reports_data view to use item_id as fallback
CREATE VIEW registration_reports_data AS
SELECT
    rfd.line_item_id,
    -- Show negative line amount for refunded payments
    CASE
        WHEN rfd.payment_status = 'refunded' THEN -rfd.line_amount
        ELSE rfd.line_amount
    END as line_amount,
    rfd.quantity,
    rfd.line_item_type,
    rfd.description,
    rfd.item_id,
    rfd.discount_code_id,
    rfd.line_item_created_at,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.invoice_status,
    rfd.sync_status,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    rfd.payment_id,
    rfd.payment_status,
    -- Show negative payment amount for refunded payments
    CASE
        WHEN rfd.payment_status = 'refunded' THEN -rfd.payment_amount
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
    -- Show negative absolute amount for refunded payments
    CASE
        WHEN rfd.payment_status = 'refunded' THEN -rfd.absolute_amount
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
