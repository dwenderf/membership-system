-- Update payment_status enum to include 'awaiting_payment' and remove 'processing'

-- First, check what constraint exists (for reference)
-- SELECT conname, consrc FROM pg_constraint WHERE conname LIKE '%payment_status%';

-- Add the new enum value 'awaiting_payment' to the existing constraint
-- We need to drop and recreate the constraint to modify it

-- Step 1: Drop the existing constraint
ALTER TABLE user_registrations DROP CONSTRAINT IF EXISTS user_registrations_payment_status_check;

-- Step 2: Add new constraint with both 'awaiting_payment' and 'processing'
ALTER TABLE user_registrations 
ADD CONSTRAINT user_registrations_payment_status_check 
CHECK (payment_status IN ('awaiting_payment', 'processing', 'paid', 'failed', 'refunded'));

-- Note: 
-- 'awaiting_payment' = spot reserved, user needs to submit payment
-- 'processing' = payment submitted to Stripe, waiting for result
-- 'paid' = payment completed successfully
-- 'failed' = payment failed
-- 'refunded' = payment was refunded