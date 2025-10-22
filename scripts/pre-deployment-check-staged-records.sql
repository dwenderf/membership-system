-- Pre-deployment check: Find recent 'staged' records that might be in-progress payments
-- Run this right before deploying to production to identify any active payment sessions
-- that could be affected by the deployment

-- Check for staged records created in the last 10 minutes
SELECT
  id,
  staging_metadata->>'user_id' as user_id,
  staging_metadata->>'stripe_payment_intent_id' as payment_intent_id,
  net_amount,
  invoice_status,
  sync_status,
  staged_at,
  AGE(NOW(), staged_at) as age
FROM xero_invoices
WHERE
  sync_status = 'staged'
  AND payment_id IS NULL
  AND staged_at > NOW() - INTERVAL '10 minutes'
ORDER BY staged_at DESC;

-- If this returns any rows, consider:
-- 1. Wait a few minutes for those payments to complete
-- 2. Or be prepared to manually reconcile those specific records after deployment
-- 3. Check Stripe dashboard to see if those payment intents are still pending

-- Also check for any corresponding payment records
SELECT
  xp.id,
  xp.xero_invoice_id,
  xp.staging_metadata->>'payment_id' as payment_id,
  xp.staging_metadata->>'stripe_payment_intent_id' as payment_intent_id,
  xp.amount_paid,
  xp.sync_status,
  xp.staged_at,
  AGE(NOW(), xp.staged_at) as age
FROM xero_payments xp
WHERE
  xp.sync_status = 'staged'
  AND xp.staged_at > NOW() - INTERVAL '10 minutes'
ORDER BY xp.staged_at DESC;
