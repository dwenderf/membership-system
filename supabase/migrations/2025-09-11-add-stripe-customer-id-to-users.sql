-- Add stripe_customer_id column to users table
-- This will store the Stripe customer ID when users set up payment methods

ALTER TABLE users 
ADD COLUMN stripe_customer_id TEXT;

-- Add comment to document the column
COMMENT ON COLUMN users.stripe_customer_id IS 'Stripe customer ID associated with this user for payment processing';

-- Add index for performance when looking up by stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id 
ON users (stripe_customer_id) 
WHERE stripe_customer_id IS NOT NULL;