-- Add stripe_payment_intent_id to user_registrations table for consistency with user_memberships

-- Add the column
ALTER TABLE user_registrations 
ADD COLUMN stripe_payment_intent_id text;

-- Add index for performance (queries by payment intent ID)
CREATE INDEX idx_user_registrations_stripe_payment_intent_id 
ON user_registrations(stripe_payment_intent_id);

-- Add comment for clarity
COMMENT ON COLUMN user_registrations.stripe_payment_intent_id IS 'Stripe payment intent ID for this registration payment';