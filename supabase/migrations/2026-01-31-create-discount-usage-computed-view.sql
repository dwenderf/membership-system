-- Create computed view for discount usage based on xero_invoice_line_items
-- This view provides a single source of truth for discount tracking,
-- eliminating the need to maintain a separate discount_usage table

-- Drop the view if it exists (for re-running migration)
DROP VIEW IF EXISTS discount_usage_computed;

-- Create the view using UNION of alternate registrations and regular user_registrations paths
CREATE VIEW discount_usage_computed AS
-- Alternate registrations path
SELECT
    xil.id AS id,
    u.id AS user_id,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.email AS user_email,
    u.member_id AS user_member_id,
    xil.discount_code_id,
    dc.discount_category_id,
    r.season_id,
    s.name AS season_name,
    s.start_date AS season_start_date,
    s.end_date AS season_end_date,
    CASE
        WHEN xi.invoice_type = 'ACCREC' THEN -xil.line_amount
        WHEN xi.invoice_type = 'ACCRECCREDIT' THEN xil.line_amount
    END AS amount_saved,
    xi.created_at AS used_at,
    r.id AS registration_id,
    r.name AS registration_name,
    dc.code AS discount_code,
    dcat.name AS discount_category_name,
    dcat.accounting_code AS discount_category_accounting_code,
    dcat.max_discount_per_user_per_season AS discount_category_max_per_season,
    xi.invoice_type,
    xi.invoice_number,
    xi.sync_status
FROM xero_invoice_line_items xil
LEFT JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dcat.id = dc.discount_category_id
LEFT JOIN alternate_selections asel ON xi.payment_id = asel.payment_id
LEFT JOIN alternate_registrations ar ON asel.alternate_registration_id = ar.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON u.id = p.user_id
LEFT JOIN registrations r ON ar.registration_id = r.id
LEFT JOIN seasons s ON s.id = r.season_id
WHERE r.season_id IS NOT NULL
  AND xi.sync_status IN ('synced', 'pending')
  AND xil.line_item_type = 'discount'

UNION

-- Regular user_registrations path
SELECT
    xil.id AS id,
    u.id AS user_id,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.email AS user_email,
    u.member_id AS user_member_id,
    xil.discount_code_id,
    dc.discount_category_id,
    r.season_id,
    s.name AS season_name,
    s.start_date AS season_start_date,
    s.end_date AS season_end_date,
    CASE
        WHEN xi.invoice_type = 'ACCREC' THEN -xil.line_amount
        WHEN xi.invoice_type = 'ACCRECCREDIT' THEN xil.line_amount
    END AS amount_saved,
    xi.created_at AS used_at,
    r.id AS registration_id,
    r.name AS registration_name,
    dc.code AS discount_code,
    dcat.name AS discount_category_name,
    dcat.accounting_code AS discount_category_accounting_code,
    dcat.max_discount_per_user_per_season AS discount_category_max_per_season,
    xi.invoice_type,
    xi.invoice_number,
    xi.sync_status
FROM xero_invoice_line_items xil
LEFT JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
LEFT JOIN discount_categories dcat ON dcat.id = dc.discount_category_id
LEFT JOIN user_registrations ur ON xi.payment_id = ur.payment_id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON u.id = p.user_id
LEFT JOIN registrations r ON ur.registration_id = r.id
LEFT JOIN seasons s ON s.id = r.season_id
WHERE r.season_id IS NOT NULL
  AND xi.sync_status IN ('synced', 'pending')
  AND xil.line_item_type = 'discount';

-- Enable security_invoker so the view respects RLS on underlying tables
-- Users will only see records they have access to via the users/payments tables
ALTER VIEW discount_usage_computed SET (security_invoker = true);

-- Grant access to authenticated users
GRANT SELECT ON discount_usage_computed TO authenticated;

COMMENT ON VIEW discount_usage_computed IS 'Computed view of discount usage derived from xero_invoice_line_items. Provides single source of truth for discount tracking with proper reversal handling for credit notes. Includes user, season, and category details for reporting. RLS is enforced via security_invoker from underlying tables.';
