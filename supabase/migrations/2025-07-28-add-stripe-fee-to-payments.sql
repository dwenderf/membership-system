-- Add stripe_fee_amount column to payments table
-- This will store the Stripe processing fees for each payment

BEGIN;

-- Add stripe_fee_amount column to payments table
ALTER TABLE payments ADD COLUMN stripe_fee_amount INTEGER DEFAULT 0; -- in cents

-- Add comment to document the column
COMMENT ON COLUMN payments.stripe_fee_amount IS 'Stripe processing fees in cents (2.9% + $0.30 standard rate)';

COMMIT; 