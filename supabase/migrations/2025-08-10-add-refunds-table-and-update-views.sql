-- Migration: Add refunds table and update payment status enum
-- Created: 2025-08-10

-- 1. Create refunds table
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    reason TEXT,
    stripe_refund_id TEXT,
    xero_credit_note_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    processed_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- 2. Drop dependent view before altering payments.status

DROP VIEW IF EXISTS membership_reports_data CASCADE;
DROP VIEW IF EXISTS registration_reports_data CASCADE;
DROP VIEW IF EXISTS reports_financial_data CASCADE;
DROP VIEW IF EXISTS reports_data;
DROP VIEW IF EXISTS recent_transactions;

CREATE VIEW recent_transactions AS
SELECT 
        xi.id as transaction_id,
        xi.invoice_number,
        xi.net_amount as amount,
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
                'unknown'::text
        ) as transaction_type,
        -- Get the actual item ID from line items
        (SELECT xili.item_id 
         FROM xero_invoice_line_items xili 
         WHERE xili.xero_invoice_id = xi.id 
         LIMIT 1) as item_id
FROM xero_invoices xi
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
WHERE xi.payment_id IS NOT NULL
    AND p.status = 'completed'
ORDER BY xi.created_at DESC;

-- Drop and recreate reports_financial_data view to include total_refunded

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
        COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id = p.id AND r.status = 'completed'), 0) AS total_refunded
FROM xero_invoice_line_items xil
INNER JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
WHERE xi.sync_status = 'synced'
    AND xi.invoice_status != 'DRAFT'
    AND p.status = 'completed';

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

-- 3. RLS policy for refunds (admin-only access)
-- Example: Only allow admins to select/insert/update/delete
-- You may need to adjust this for your specific role setup

-- Enable RLS
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- Policy: Only admin users can access refunds
CREATE POLICY "Admin access to refunds" ON refunds
        FOR ALL
        USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin));

-- Add RLS policy for all views (admin only)
ALTER VIEW recent_transactions SET (security_invoker = true);
GRANT SELECT ON recent_transactions TO authenticated;

ALTER VIEW reports_financial_data SET (security_invoker = true);
GRANT SELECT ON reports_financial_data TO authenticated;

ALTER VIEW membership_reports_data SET (security_invoker = true);
GRANT SELECT ON membership_reports_data TO authenticated;

ALTER VIEW registration_reports_data SET (security_invoker = true);
GRANT SELECT ON registration_reports_data TO authenticated;