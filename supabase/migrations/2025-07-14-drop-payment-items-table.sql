-- Drop payment_items table completely
-- This table was redundant with xero_invoice_line_items which is the real source of truth

-- Drop the table and all its data
-- Note: This will cascade to drop any dependent objects
DROP TABLE IF EXISTS payment_items CASCADE;

-- Add comment for future reference
COMMENT ON SCHEMA public IS 'payment_items table removed 2025-07-14 - transaction details are now stored in xero_invoice_line_items';