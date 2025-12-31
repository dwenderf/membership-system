-- Backfill stripe_payment_intent_id in user_registrations from payments table
-- This fixes historical records where the payment intent ID was never populated
-- despite the field existing since 2025-07-11

-- Summary of what this migration does:
-- For user_registrations records that:
--   1. Have a payment_id (linked to payments table)
--   2. Have NULL stripe_payment_intent_id
--   3. The linked payment has a stripe_payment_intent_id
-- Copy the stripe_payment_intent_id from payments to user_registrations

-- Show summary before update
DO $$
DECLARE
  records_to_update INTEGER;
BEGIN
  SELECT COUNT(*) INTO records_to_update
  FROM user_registrations ur
  INNER JOIN payments p ON ur.payment_id = p.id
  WHERE ur.stripe_payment_intent_id IS NULL
    AND p.stripe_payment_intent_id IS NOT NULL;

  RAISE NOTICE 'Records to update: %', records_to_update;
END $$;

-- Perform the backfill
UPDATE user_registrations ur
SET stripe_payment_intent_id = p.stripe_payment_intent_id,
    updated_at = NOW()
FROM payments p
WHERE ur.payment_id = p.id
  AND ur.stripe_payment_intent_id IS NULL
  AND p.stripe_payment_intent_id IS NOT NULL;

-- Show summary after update
DO $$
DECLARE
  records_updated INTEGER;
  total_paid_registrations INTEGER;
  registrations_with_payment_intent INTEGER;
BEGIN
  -- Get counts for summary
  GET DIAGNOSTICS records_updated = ROW_COUNT;

  SELECT COUNT(*) INTO total_paid_registrations
  FROM user_registrations
  WHERE payment_status = 'paid';

  SELECT COUNT(*) INTO registrations_with_payment_intent
  FROM user_registrations
  WHERE stripe_payment_intent_id IS NOT NULL;

  RAISE NOTICE 'Backfill complete!';
  RAISE NOTICE '  Records updated: %', records_updated;
  RAISE NOTICE '  Total paid registrations: %', total_paid_registrations;
  RAISE NOTICE '  Registrations with payment intent ID: %', registrations_with_payment_intent;
  RAISE NOTICE '  Coverage: %%%', ROUND((registrations_with_payment_intent::numeric / NULLIF(total_paid_registrations, 0) * 100)::numeric, 2);
END $$;
