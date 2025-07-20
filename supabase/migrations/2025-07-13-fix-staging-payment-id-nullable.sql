-- Fix staging tables to allow nullable payment_id for staging-first approach
-- payment_id will be null during staging, then populated when payment record is created

-- Make payment_id nullable in xero_invoices for staging
ALTER TABLE xero_invoices 
ALTER COLUMN payment_id DROP NOT NULL;

-- Add comment to clarify the staging approach
COMMENT ON COLUMN xero_invoices.payment_id IS 'Payment ID - nullable during staging, populated when payment record is created';