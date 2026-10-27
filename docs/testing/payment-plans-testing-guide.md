# Payment Plans Testing Guide

This guide explains how to test payment plans without waiting for monthly intervals or the daily cron run. Do this on a local or preview environment against the development database, with Stripe in test mode.

## How installments are stored

A payment plan is a Xero invoice (`xero_invoices`) with one `xero_payments` row per installment (`payment_type = 'installment'`). An installment that hasn't been charged yet has `sync_status = 'planned'` and a `planned_payment_date`. The `payment_plan_summary` view rolls these up per invoice; the admin pages read from it.

The daily cron (`/api/cron/payment-plans`) and the admin **Run Payments** button both call `processDuePayments()` in `src/lib/services/payment-plan-processor.ts`, so they charge installments the same way.

## Prerequisites

1. **Enable payment plans for a test user**:
   ```sql
   UPDATE users
   SET payment_plan_enabled = true
   WHERE email = 'test@example.com';
   ```

2. **Make sure the user has a saved payment method** (via the normal setup intent flow).

3. **Create a plan** by registering as that user and choosing the payment plan option at checkout. The first installment is charged immediately; the rest are created as `planned` rows.

## Testing Workflow

### Step 1: Find the plan's installments

```sql
SELECT xp.id, xp.installment_number, xp.amount_paid, xp.planned_payment_date,
       xp.sync_status, xp.attempt_count, xp.last_attempt_at, xp.failure_reason
FROM xero_payments xp
JOIN xero_invoices xi ON xi.id = xp.xero_invoice_id
WHERE (xi.staging_metadata ->> 'user_id')::uuid = 'YOUR_USER_ID'
  AND xp.payment_type = 'installment'
ORDER BY xp.installment_number;
```

### Step 2: Make an installment due today

```sql
UPDATE xero_payments
SET planned_payment_date = CURRENT_DATE
WHERE id = 'INSTALLMENT_ID';
```

### Step 3: Process due payments

Go to **Admin → Reports → Payment Plans** and click **Run Payments**. This charges every installment due today or earlier and sends pre-notifications for installments due in 3 days, the same as the cron job.

Unlike the cron, **Run Payments** also retries installments that have used up their automatic attempts or are still inside the retry interval: an admin pressing the button is treated as a deliberate retry.

To retry a single failed installment, open the member under **Admin → Reports → Users**, find the payment plan section, and click **Retry payment** on that installment.

### Step 4: Test pre-notifications (3 days before)

Set an installment's `planned_payment_date` to `CURRENT_DATE + 3`, then click **Run Payments**. A pre-notification email should be logged for that member.

### Step 5: Test payment failures

1. Give the test user a card that declines (see [Stripe Test Cards](#stripe-test-cards)), e.g. `4000 0000 0000 0002`.
2. Make an installment due today (Step 2) and click **Run Payments**. It should fail and `attempt_count` should go to 1.
3. To test the cron's automatic retry spacing (`RETRY_INTERVAL_HOURS` in `src/lib/services/payment-plan-config.ts`) without waiting a day, move the last attempt back:
   ```sql
   UPDATE xero_payments
   SET last_attempt_at = now() - interval '25 hours'
   WHERE id = 'INSTALLMENT_ID';
   ```
   Then run the cron job locally (`CRON_SECRET` from your `.env.local`):
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/payment-plans
   ```
   After `MAX_PAYMENT_ATTEMPTS` failures the cron stops retrying; **Run Payments** and **Retry payment** still will.

### Step 6: Test early payoff

As the member, use the early payoff option on their payment plan in the user dashboard. This should:
- Charge the remaining balance
- Mark the remaining installments as paid
- Send the completion email

### Step 7: Test payment method removal protection

As a member with an outstanding plan balance, try to remove the saved payment method from the user dashboard. It should be refused with a message asking them to pay off the balance first.

## Testing Scenarios

### Scenario 1: Happy path
1. Create a plan with 4 installments
2. Make installment 2 due today, click **Run Payments**: it succeeds
3. Repeat for installments 3 and 4: the plan shows as completed

### Scenario 2: Payment fails, then succeeds on retry
1. Switch the user to a declining test card
2. Make a payment due and click **Run Payments**: it fails, `attempt_count` = 1
3. Switch the user back to a valid test card
4. Click **Retry payment** on the installment: it succeeds

### Scenario 3: Max retries exceeded
1. Use a declining test card
2. Fail the installment `MAX_PAYMENT_ATTEMPTS` times (move `last_attempt_at` back between cron runs, as in Step 5)
3. Run the cron again: the installment is skipped

### Scenario 4: Pre-notifications
1. Set an installment's `planned_payment_date` to 3 days from today
2. Click **Run Payments**
3. Check `email_logs` for the pre-notification

## Useful SQL Queries

### Payment plan status for a user
```sql
SELECT invoice_id, status, total_amount, paid_amount, installments_paid,
       total_installments, next_payment_date, registration_name
FROM payment_plan_summary
WHERE contact_id = 'YOUR_USER_ID';
```

### Email logs
```sql
SELECT event_type, status, sent_at, loops_event_id, email_data
FROM email_logs
WHERE user_id = 'YOUR_USER_ID'
  AND event_type LIKE 'payment_plan%'
ORDER BY sent_at DESC;
```

### Reset a failed installment for re-testing
```sql
UPDATE xero_payments
SET sync_status = 'planned',
    attempt_count = 0,
    last_attempt_at = NULL,
    failure_reason = NULL
WHERE id = 'INSTALLMENT_ID';
```

## Environment Variables Needed for Testing

These come from `vercel env pull .env.local` (see AGENTS.md). The payment-plan-specific ones are:

```bash
LOOPS_PAYMENT_PLAN_PRE_NOTIFICATION_TEMPLATE_ID=
LOOPS_PAYMENT_PLAN_PAYMENT_PROCESSED_TEMPLATE_ID=
LOOPS_PAYMENT_PLAN_PAYMENT_FAILED_TEMPLATE_ID=
LOOPS_PAYMENT_PLAN_COMPLETED_TEMPLATE_ID=
STRIPE_SECRET_KEY=sk_test_...
```

## Stripe Test Cards

- **Success**: `4242 4242 4242 4242`
- **Generic Decline**: `4000 0000 0000 0002`
- **Insufficient Funds**: `4000 0000 0000 9995`
- **Expired Card**: `4000 0000 0000 0069`
- **Processing Error**: `4000 0000 0000 0119`

Any future expiration date, any 3-digit CVC, any ZIP code.

## Debugging Tips

1. **Check logs**: search for `payment-plan-`, `cron-payment-plans-` and `manual-run-payments-`.
2. **Forward Stripe webhooks locally** with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe-webhook
   ```
3. **Check database state** after each step with the queries above.
4. **Check emails** in the Loops dashboard or the `email_logs` table.
