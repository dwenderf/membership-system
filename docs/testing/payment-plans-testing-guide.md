# Payment Plans Testing Guide

This guide explains how to test the payment plans feature without waiting for monthly intervals or daily cron execution.

## Prerequisites

1. **Set ADMIN_SECRET in your environment**:
   ```bash
   ADMIN_SECRET=your_secure_secret_here
   ```

2. **Create a test user with payment plan eligibility**:
   ```sql
   UPDATE users
   SET payment_plan_enabled = true
   WHERE email = 'test@example.com';
   ```

3. **Ensure user has a saved payment method** (via normal setup intent flow)

## Testing Workflow

### Step 1: Create a Test Payment Plan

Register for an event using the payment plan option (once registration flow is implemented), or manually create one in the database:

```sql
-- This will be done automatically during registration, but for testing you can create manually:
INSERT INTO payment_plans (
  id,
  user_registration_id,
  user_id,
  total_amount,
  paid_amount,
  installment_amount,
  installments_count,
  installments_paid,
  next_payment_date,
  status,
  created_at
) VALUES (
  gen_random_uuid(),
  'your_registration_id',
  'your_user_id',
  40000,  -- $400.00 in cents
  10000,  -- $100.00 already paid (first installment)
  10000,  -- $100.00 per installment
  4,
  1,
  CURRENT_DATE + INTERVAL '30 days',  -- 30 days from now
  'active',
  NOW()
);

-- Create transaction records (3 remaining payments)
-- The ID from above INSERT will be needed
INSERT INTO payment_plan_transactions (
  payment_plan_id,
  amount,
  installment_number,
  scheduled_date,
  status,
  attempt_count
) VALUES
  ('payment_plan_id', 10000, 2, CURRENT_DATE + INTERVAL '30 days', 'pending', 0),
  ('payment_plan_id', 10000, 3, CURRENT_DATE + INTERVAL '60 days', 'pending', 0),
  ('payment_plan_id', 10000, 4, CURRENT_DATE + INTERVAL '90 days', 'pending', 0);
```

### Step 2: Speed Up Testing - Make Payment Due Today

Use the schedule update endpoint to make the next payment due immediately:

```bash
curl -X POST "http://localhost:3000/api/admin/payment-plans/update-schedule?secret=YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_plan_id": "YOUR_PAYMENT_PLAN_ID",
    "days_from_now": 0
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Updated 3 transactions",
  "transactions_updated": 3,
  "updates": [
    {
      "id": "tx-uuid-1",
      "installment_number": 2,
      "old_date": "2025-12-03",
      "new_date": "2025-11-03"
    },
    {
      "id": "tx-uuid-2",
      "installment_number": 3,
      "old_date": "2026-01-02",
      "new_date": "2025-12-03"
    },
    {
      "id": "tx-uuid-3",
      "installment_number": 4,
      "old_date": "2026-02-01",
      "new_date": "2026-01-02"
    }
  ]
}
```

This schedules:
- Installment 2: Today
- Installment 3: 30 days from today
- Installment 4: 60 days from today

### Step 3: Manually Trigger Payment Processing

Now manually process the payments without waiting for the cron job:

```bash
curl -X POST "http://localhost:3000/api/admin/payment-plans/process-manual?secret=YOUR_ADMIN_SECRET"
```

**Response:**
```json
{
  "success": true,
  "message": "Manual processing completed",
  "results": {
    "mode": "date_based",
    "dateUsed": "2025-11-03",
    "paymentsProcessed": 1,
    "paymentsFailed": 0,
    "retriesAttempted": 0,
    "preNotificationsSent": 0,
    "completionEmailsSent": 0,
    "transactionsFound": 1,
    "errors": []
  }
}
```

### Step 4: Test Pre-Notifications (3 Days Before)

To test pre-notification emails, override the date to 3 days before a scheduled payment:

```bash
# If installment 3 is scheduled for 2025-12-03
# Process as if today is 2025-11-30 (3 days before)
curl -X POST "http://localhost:3000/api/admin/payment-plans/process-manual?override_date=2025-11-30&secret=YOUR_ADMIN_SECRET"
```

This will send pre-notification emails for payments scheduled 3 days out.

### Step 5: Test Payment Failures

To test payment failure and retry logic:

1. **Use a test card that will decline** (Stripe test mode):
   - Card: `4000 0000 0000 0002` (generic decline)

2. **Make payment due today and process**:
   ```bash
   # Make next payment due
   curl -X POST "http://localhost:3000/api/admin/payment-plans/update-schedule?secret=YOUR_ADMIN_SECRET" \
     -H "Content-Type: application/json" \
     -d '{
       "transaction_id": "TRANSACTION_ID",
       "days_from_now": 0
     }'

   # Process payment (will fail)
   curl -X POST "http://localhost:3000/api/admin/payment-plans/process-manual?secret=YOUR_ADMIN_SECRET"
   ```

3. **Check the transaction status**:
   ```sql
   SELECT id, installment_number, status, attempt_count, failure_reason, last_attempt_at
   FROM payment_plan_transactions
   WHERE payment_plan_id = 'YOUR_PAYMENT_PLAN_ID';
   ```

4. **Test retry (normally waits 24 hours)**:
   ```bash
   # Process with date override to skip 24hr wait
   curl -X POST "http://localhost:3000/api/admin/payment-plans/process-manual?override_date=2025-11-04&secret=YOUR_ADMIN_SECRET"
   ```

### Step 6: Test Specific Transaction

To process a specific transaction regardless of scheduled date:

```bash
curl -X POST "http://localhost:3000/api/admin/payment-plans/process-manual?transaction_id=TRANSACTION_UUID&secret=YOUR_ADMIN_SECRET"
```

### Step 7: Test Early Payoff

Test the early payoff functionality:

```bash
curl -X POST "http://localhost:3000/api/payment-plans/PAYMENT_PLAN_ID/payoff" \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

This will:
- Charge the remaining balance
- Mark all pending transactions as completed
- Send completion email
- Update payment plan status to 'completed'

### Step 8: Test Payment Method Removal Protection

Try to remove a payment method with outstanding balance:

```bash
curl -X DELETE "http://localhost:3000/api/remove-payment-method" \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN"
```

**Expected Response (if balance exists):**
```json
{
  "error": "Cannot remove payment method with outstanding payment plan balance",
  "requiresPayoff": true,
  "outstandingAmount": 30000
}
```

## Testing Scenarios

### Scenario 1: Happy Path - All Payments Succeed
1. Create payment plan with 4 installments
2. Make installment 2 due today
3. Process manually - should succeed
4. Make installment 3 due today
5. Process manually - should succeed
6. Make installment 4 due today
7. Process manually - should succeed and mark plan as completed

### Scenario 2: Payment Fails Then Succeeds on Retry
1. Update user to use declining test card
2. Make payment due and process - should fail
3. Check `attempt_count` is 1
4. Update user to valid test card
5. Process with date override - should succeed

### Scenario 3: Max Retries Exceeded
1. Use declining test card
2. Process payment - fails (attempt 1)
3. Override date +1 day, process - fails (attempt 2)
4. Override date +2 days, process - fails (attempt 3)
5. Check transaction status - should still be 'failed' with attempt_count = 3
6. Override date +3 days, process - should skip (max attempts reached)

### Scenario 4: Early Payoff
1. Create payment plan with remaining balance
2. Call payoff API
3. Check all transactions marked as completed
4. Check payment plan status is 'completed'
5. Verify completion email was sent

### Scenario 5: Pre-Notifications
1. Schedule payment for 3 days from now
2. Process with `override_date` = today
3. Check email logs for pre-notification
4. Advance to scheduled date
5. Process actual payment
6. Check payment processed email sent

## Useful SQL Queries

### Check Payment Plan Status
```sql
SELECT
  pp.id,
  pp.status,
  pp.total_amount,
  pp.paid_amount,
  pp.installments_paid,
  pp.next_payment_date,
  u.email,
  r.name as registration_name
FROM payment_plans pp
JOIN users u ON pp.user_id = u.id
JOIN user_registrations ur ON pp.user_registration_id = ur.id
JOIN registrations r ON ur.registration_id = r.id
WHERE pp.status = 'active';
```

### Check All Transactions for a Plan
```sql
SELECT
  installment_number,
  amount,
  scheduled_date,
  processed_date,
  status,
  attempt_count,
  failure_reason,
  stripe_payment_intent_id
FROM payment_plan_transactions
WHERE payment_plan_id = 'YOUR_PLAN_ID'
ORDER BY installment_number;
```

### Check Email Logs
```sql
SELECT
  event_type,
  sent_at,
  loops_event_id,
  metadata
FROM email_logs
WHERE user_id = 'YOUR_USER_ID'
AND event_type LIKE 'payment_plan%'
ORDER BY sent_at DESC;
```

### Reset a Transaction for Re-testing
```sql
UPDATE payment_plan_transactions
SET
  status = 'pending',
  attempt_count = 0,
  last_attempt_at = NULL,
  failure_reason = NULL,
  stripe_payment_intent_id = NULL,
  processed_date = NULL,
  payment_id = NULL
WHERE id = 'TRANSACTION_ID';
```

## Environment Variables Needed for Testing

Add these to your `.env.local`:

```bash
# Admin testing secret
ADMIN_SECRET=your_secure_secret_here

# Loops email template IDs (get from Loops dashboard after creating templates)
LOOPS_PAYMENT_PLAN_PRE_NOTIFICATION_TEMPLATE_ID=your_template_id
LOOPS_PAYMENT_PLAN_PAYMENT_PROCESSED_TEMPLATE_ID=your_template_id
LOOPS_PAYMENT_PLAN_PAYMENT_FAILED_TEMPLATE_ID=your_template_id
LOOPS_PAYMENT_PLAN_COMPLETED_TEMPLATE_ID=your_template_id

# Stripe test keys
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Stripe Test Cards

Use these for different scenarios:

- **Success**: `4242 4242 4242 4242`
- **Generic Decline**: `4000 0000 0000 0002`
- **Insufficient Funds**: `4000 0000 0000 9995`
- **Expired Card**: `4000 0000 0000 0069`
- **Processing Error**: `4000 0000 0000 0119`

All test cards:
- Any future expiration date
- Any 3-digit CVC
- Any ZIP code

## Debugging Tips

1. **Check logs**: Look for payment plan processing logs in your console
   - Search for: `payment-plan-`, `cron-payment-plans-`

2. **Verify Stripe webhooks**: If testing actual Stripe flow, use Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe-webhook
   ```

3. **Check database state**: After each operation, verify the state matches expectations

4. **Test emails**: Check Loops dashboard for sent emails or check email_logs table

## Production Considerations

⚠️ **Important**: These testing endpoints should NOT be accessible in production without proper authentication!

Recommendations:
- Use `ADMIN_SECRET` that's different in each environment
- Consider IP whitelisting for admin endpoints
- Add additional authorization checks
- Monitor usage of these endpoints
- Consider disabling in production entirely

## Next Steps After Testing

Once you've verified the payment plan system works correctly:

1. ✅ Database migrations applied
2. ✅ Core services working
3. ✅ Emails sending correctly
4. ✅ Retry logic functioning
5. ✅ Early payoff working
6. ⏳ Implement registration checkout UI
7. ⏳ Implement admin interfaces
8. ⏳ Implement user account payment plans section
9. ⏳ Update Stripe webhook for payment plans
10. ⏳ Deploy to staging for user acceptance testing
