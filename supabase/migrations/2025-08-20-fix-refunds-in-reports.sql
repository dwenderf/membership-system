-- Migration: Fix refunds showing as positive income and include credit notes in transactions
-- Created: 2025-08-20
-- Issues: 
-- 1. Refunded registrations/memberships showing as positive income instead of negative
-- 2. Credit notes (refunds) not appearing in recent transactions

-- Drop dependent views
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS membership_reports_data CASCADE;
DROP VIEW IF EXISTS recent_transactions CASCADE;

-- Recreate recent_transactions view to include credit notes
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

-- Recreate membership_reports_data view with proper refund handling
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

-- Recreate registration_reports_data view with proper refund handling
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
ALTER VIEW recent_transactions SET (security_invoker = true);
ALTER VIEW membership_reports_data SET (security_invoker = true);
ALTER VIEW registration_reports_data SET (security_invoker = true);

-- Grant access to the views
GRANT SELECT ON recent_transactions TO authenticated;
GRANT SELECT ON membership_reports_data TO authenticated;
GRANT SELECT ON registration_reports_data TO authenticated;