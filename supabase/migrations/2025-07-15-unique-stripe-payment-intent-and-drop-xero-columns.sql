-- Add unique constraint to prevent duplicate user_memberships for the same Stripe payment intent
ALTER TABLE user_memberships
  ADD CONSTRAINT unique_stripe_payment_intent_id UNIQUE (stripe_payment_intent_id);

-- Drop unused xero_synced and xero_sync_error columns if they exist
ALTER TABLE user_memberships DROP COLUMN IF EXISTS xero_synced;
ALTER TABLE user_memberships DROP COLUMN IF EXISTS xero_sync_error; 