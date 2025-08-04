-- Add discount_code_id to xero_invoice_line_items and backfill data
-- This migration properly categorizes discount line items vs donation line items

-- Step 1: Add the new column (nullable initially)
ALTER TABLE xero_invoice_line_items 
ADD COLUMN IF NOT EXISTS discount_code_id UUID;

-- Debug: Check what discount line items we have
-- SELECT description, line_item_type FROM xero_invoice_line_items 
-- WHERE line_item_type = 'discount' AND description LIKE 'Discount: %';

-- Step 2: Backfill discount_code_id for actual discount codes
-- Parse "Discount: " from description and match to discount_codes.code
UPDATE xero_invoice_line_items 
SET discount_code_id = (
  SELECT dc.id 
  FROM discount_codes dc 
  WHERE dc.code = TRIM(SUBSTRING(xero_invoice_line_items.description FROM 'Discount: ([^[:space:]]+)'))
  ORDER BY dc.created_at DESC
  LIMIT 1
)
WHERE line_item_type = 'discount'
  AND description LIKE 'Discount: %'
  AND discount_code_id IS NULL;

-- Step 3: Convert remaining discount items to donations
-- These are the hardcoded ones like FINANCIAL_ASSISTANCE and FREE_MEMBERSHIP
UPDATE xero_invoice_line_items 
SET line_item_type = 'donation'
WHERE line_item_type = 'discount'
  AND discount_code_id IS NULL;

-- Step 4: Add foreign key constraint
ALTER TABLE xero_invoice_line_items 
ADD CONSTRAINT fk_xero_invoice_line_items_discount_code_id 
FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id);

-- Step 5: Add index for performance
CREATE INDEX IF NOT EXISTS idx_xero_invoice_line_items_discount_code_id 
ON xero_invoice_line_items(discount_code_id);

-- Add comment for documentation
COMMENT ON COLUMN xero_invoice_line_items.discount_code_id IS 'Reference to discount_codes.id for actual discount codes. NULL for donation-type discounts (FINANCIAL_ASSISTANCE, FREE_MEMBERSHIP)'; 