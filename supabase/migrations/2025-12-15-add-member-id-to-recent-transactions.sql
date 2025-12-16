-- Migration: Add member_id to recent_transactions view
-- Created: 2025-12-15
-- Purpose: Include member_id in recent transactions so we can display membership numbers in the UI

DROP VIEW IF EXISTS recent_transactions CASCADE;

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
    u.member_id,
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
    -- Include both regular invoices with completed/refunded payments and all credit notes
    AND (
        (xi.invoice_type = 'ACCREC' AND p.status IN ('completed', 'refunded')) OR
        (xi.invoice_type = 'ACCRECCREDIT')
    )
ORDER BY xi.created_at DESC;

-- Set security invoker for RLS
ALTER VIEW recent_transactions SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON recent_transactions TO authenticated;
