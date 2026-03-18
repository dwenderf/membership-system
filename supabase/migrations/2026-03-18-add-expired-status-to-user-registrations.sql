-- Add 'expired' to user_registrations payment_status constraint
--
-- 'expired' is used for registrations where payment was never completed
-- (registered_at IS NULL) and the record has been abandoned. This is
-- distinct from 'failed' which means a payment was actively attempted
-- and rejected by Stripe.
--
-- The maintenance cron will transition awaiting_payment records to
-- 'expired' when registered_at IS NULL and created_at > 1 hour ago.

-- Step 1: Drop the existing constraint
ALTER TABLE user_registrations DROP CONSTRAINT IF EXISTS user_registrations_payment_status_check;

-- Step 2: Recreate with 'expired' added
ALTER TABLE user_registrations
ADD CONSTRAINT user_registrations_payment_status_check
CHECK (payment_status IN ('awaiting_payment', 'processing', 'paid', 'failed', 'refunded', 'expired'));

-- Status reference:
-- 'awaiting_payment' = spot reserved, user needs to submit payment
-- 'processing'       = payment submitted to Stripe, waiting for result
-- 'paid'             = payment completed successfully (registered_at is set)
-- 'failed'           = payment was attempted and failed in Stripe
-- 'refunded'         = payment was completed then refunded (registered_at is set)
-- 'expired'          = registration was started but never completed (registered_at IS NULL)
