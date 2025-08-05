-- Create new reports_financial_data view with discount information
-- Keep old reports_data view for backward compatibility with reports_active_memberships
DROP VIEW IF EXISTS reports_financial_data;

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

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_reports_data_line_item_type ON xero_invoice_line_items(line_item_type);
CREATE INDEX IF NOT EXISTS idx_reports_data_invoice_status ON xero_invoices(invoice_status);
CREATE INDEX IF NOT EXISTS idx_reports_data_sync_status ON xero_invoices(sync_status);
CREATE INDEX IF NOT EXISTS idx_reports_data_payment_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_reports_data_discount_code_id ON xero_invoice_line_items(discount_code_id); 