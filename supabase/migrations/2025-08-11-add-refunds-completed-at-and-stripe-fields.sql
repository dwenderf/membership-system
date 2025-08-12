-- Add completed_at and Stripe tracking fields to refunds table to mirror payments table structure

-- Add completed_at timestamp field
ALTER TABLE refunds 
ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;

-- Add Stripe tracking fields for better data integrity and lookups
ALTER TABLE refunds 
ADD COLUMN stripe_payment_intent_id TEXT,
ADD COLUMN stripe_charge_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN refunds.completed_at IS 'Timestamp when the refund was completed in Stripe';
COMMENT ON COLUMN refunds.stripe_payment_intent_id IS 'Stripe Payment Intent ID for easy lookup and matching (mirrors payments table)';
COMMENT ON COLUMN refunds.stripe_charge_id IS 'Stripe Charge ID for complete Stripe data tracking (mirrors payments table)';

-- Create index for efficient lookups by Stripe Payment Intent ID
CREATE INDEX idx_refunds_stripe_payment_intent_id ON refunds(stripe_payment_intent_id);

-- Create index for efficient lookups by Stripe Charge ID  
CREATE INDEX idx_refunds_stripe_charge_id ON refunds(stripe_charge_id);