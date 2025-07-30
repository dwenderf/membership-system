-- Add stripe_charge_id to payments table for better payment tracking
-- Charge IDs (ch_*) are what appear on bank statements and are more useful for reconciliation
ALTER TABLE payments ADD COLUMN stripe_charge_id TEXT;

-- Add index for efficient lookups
CREATE INDEX idx_payments_stripe_charge_id ON payments(stripe_charge_id);

-- Add comment explaining the field
COMMENT ON COLUMN payments.stripe_charge_id IS 'Stripe charge ID (ch_*) that appears on bank statements and is used for payment reconciliation'; 