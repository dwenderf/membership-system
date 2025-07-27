-- Create a comprehensive view for reports data
-- This view joins xero_invoice_line_items with all necessary tables for reporting
DROP VIEW IF EXISTS reports_data;

CREATE VIEW reports_data AS
SELECT
    xil.id as line_item_id,
    xil.line_amount,
    xil.quantity,
    xil.line_item_type,
    xil.description,
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
WHERE xi.sync_status = 'synced'
  AND xi.invoice_status != 'DRAFT'
  AND p.status = 'completed';

-- Add RLS policy for the view (admin only)
ALTER VIEW reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON reports_data TO authenticated;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_reports_data_line_item_type ON xero_invoice_line_items(line_item_type);
CREATE INDEX IF NOT EXISTS idx_reports_data_invoice_status ON xero_invoices(invoice_status);
CREATE INDEX IF NOT EXISTS idx_reports_data_sync_status ON xero_invoices(sync_status);
CREATE INDEX IF NOT EXISTS idx_reports_data_payment_status ON payments(status); 