# Payment Submission Tracking Enhancement

## Overview

This document outlines a future enhancement to add payment submission tracking to the payments table. This will enable better abandonment detection, improve analytics, and provide clearer semantic meaning to payment states.

**Status:** Planning - Not yet implemented
**Priority:** Nice to have (implement after current Xero matching fixes are deployed)

---

## Problem Statement

Currently, we cannot distinguish between:
- Users who abandoned the checkout before clicking "Pay"
- Users who clicked "Pay" but payment failed
- Users who clicked "Pay" and payment is processing

The `created_at` timestamp captures when the payment intent was created, and `completed_at` captures when Stripe confirmed success, but we have no timestamp for when the user actually submitted the payment to Stripe.

---

## Proposed Solution

### 1. Add `submitted_at` Timestamp

Add a new column to the `payments` table to capture when the payment was actually submitted to Stripe:

```sql
ALTER TABLE payments
ADD COLUMN submitted_at TIMESTAMP WITH TIME ZONE;
```

### 2. Add `staged` Status

Add a new status value to represent payment intents that have been created but not yet submitted by the user:

```sql
-- Remove existing constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;

-- Add new constraint with 'staged' status
ALTER TABLE payments ADD CONSTRAINT payments_status_check
CHECK (status IN ('staged', 'pending', 'completed', 'failed', 'refunded', 'cancelled'));
```

---

## Status Flow

### New Status Transitions

```
'staged' → Payment intent created, user hasn't clicked "Pay" yet
   ↓ (user clicks "Pay", frontend calls /api/mark-payment-submitted)
'pending' → User submitted to Stripe, awaiting confirmation
   ↓ (webhook: payment_intent.succeeded OR payment_intent.payment_failed)
'completed' OR 'failed' → Final state
```

### Comparison to Current Flow

**Current:**
```
'pending' → Created (ambiguous - waiting for user or waiting for Stripe?)
'completed' → Success
'failed' → Failure
```

**Proposed:**
```
'staged' → Created, waiting for user to click "Pay"
'pending' → Submitted to Stripe, awaiting confirmation
'completed' → Success
'failed' → Failure
```

---

## Implementation Details

### Phase 1: Schema Changes

**Migration 1: Add Column**
```sql
-- File: supabase/migrations/YYYY-MM-DD-add-submitted-at-to-payments.sql

ALTER TABLE payments
ADD COLUMN submitted_at TIMESTAMP WITH TIME ZONE;

-- Add index for queries filtering on submitted_at
CREATE INDEX idx_payments_submitted_at ON payments(submitted_at);
```

**Migration 2: Add Status**
```sql
-- File: supabase/migrations/YYYY-MM-DD-add-staged-status-to-payments.sql

-- Remove existing constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;

-- Add new constraint with 'staged' status
ALTER TABLE payments ADD CONSTRAINT payments_status_check
CHECK (status IN ('staged', 'pending', 'completed', 'failed', 'refunded', 'cancelled'));

-- Create index for staged payments (abandonment detection)
CREATE INDEX idx_payments_staged ON payments(status, created_at)
WHERE status = 'staged';
```

**Migration 3: Backfill Existing Data**
```sql
-- File: supabase/migrations/YYYY-MM-DD-backfill-submitted-at.sql

-- For completed payments, use completed_at as submitted_at
-- (we know they were submitted since they completed)
UPDATE payments
SET submitted_at = completed_at
WHERE status = 'completed' AND submitted_at IS NULL;

-- For failed payments, use updated_at as best guess
UPDATE payments
SET submitted_at = updated_at
WHERE status = 'failed' AND submitted_at IS NULL;

-- For refunded payments, use completed_at (they must have completed first)
UPDATE payments
SET submitted_at = completed_at
WHERE status = 'refunded' AND submitted_at IS NULL AND completed_at IS NOT NULL;

-- Pending/cancelled payments without submitted_at remain NULL
-- (these are likely abandoned or never submitted)
```

### Phase 2: Backend Code Changes

#### Change 1: New API Endpoint

**File:** `src/app/api/mark-payment-submitted/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * Mark a payment as submitted when user clicks "Pay" button
 * This is called BEFORE stripe.confirmPayment() to ensure we capture submission timestamp
 * Uses fail-fast approach: if this fails, frontend should not proceed with Stripe
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { paymentIntentId } = await request.json()

    if (!paymentIntentId) {
      return NextResponse.json(
        { error: 'Payment intent ID is required' },
        { status: 400 }
      )
    }

    // Step 1: Get the payment record
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('id, status, submitted_at')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single()

    if (fetchError || !payment) {
      logger.logPaymentProcessing(
        'mark-submitted-payment-not-found',
        'Payment not found for submission marking',
        { paymentIntentId, error: fetchError?.message },
        'error'
      )
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      )
    }

    // Step 2: Check if already submitted (idempotency)
    if (payment.submitted_at !== null) {
      logger.logPaymentProcessing(
        'mark-submitted-already-submitted',
        'Payment already marked as submitted',
        { paymentIntentId, paymentId: payment.id },
        'info'
      )
      return NextResponse.json({ success: true, alreadySubmitted: true })
    }

    // Step 3: Check if payment is in correct state
    if (payment.status !== 'staged') {
      logger.logPaymentProcessing(
        'mark-submitted-invalid-status',
        'Payment is not in staged status',
        { paymentIntentId, paymentId: payment.id, status: payment.status },
        'warn'
      )
      // Still return success to not block user, but log the issue
      return NextResponse.json({ success: true, statusMismatch: true })
    }

    // Step 4: Update payment record
    const now = new Date().toISOString()
    const { error: paymentError } = await supabase
      .from('payments')
      .update({
        status: 'pending',
        submitted_at: now,
        updated_at: now
      })
      .eq('id', payment.id)
      .eq('status', 'staged') // Double-check status hasn't changed

    if (paymentError) {
      logger.logPaymentProcessing(
        'mark-submitted-update-failed',
        'Failed to update payment submission status',
        { paymentIntentId, paymentId: payment.id, error: paymentError.message },
        'error'
      )
      return NextResponse.json(
        { error: 'Failed to mark payment as submitted' },
        { status: 500 }
      )
    }

    // Step 5: Update xero_invoices record (no submitted_at column, just for audit)
    // Note: xero_invoices doesn't need submitted_at - it has its own flow
    // (staged → pending → synced/failed/abandoned)
    const { error: invoiceError } = await supabase
      .from('xero_invoices')
      .update({
        updated_at: now
      })
      .eq('payment_id', payment.id)
      .eq('sync_status', 'staged')

    if (invoiceError) {
      // Log but don't fail - invoice update is not critical for payment flow
      logger.logPaymentProcessing(
        'mark-submitted-invoice-update-failed',
        'Failed to update invoice timestamp',
        { paymentIntentId, paymentId: payment.id, error: invoiceError.message },
        'warn'
      )
    }

    logger.logPaymentProcessing(
      'mark-submitted-success',
      'Successfully marked payment as submitted',
      { paymentIntentId, paymentId: payment.id },
      'info'
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.logPaymentProcessing(
      'mark-submitted-error',
      'Unexpected error marking payment as submitted',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

#### Change 2: Update Payment Creation (3 locations)

**Files to modify:**
1. `src/app/api/create-registration-payment-intent/route.ts`
2. `src/app/api/create-membership-payment-intent/route.ts`
3. `src/lib/services/waitlist-payment-service.ts`
4. `src/lib/services/alternate-payment-service.ts`

**Change:** Update payment record creation to use `status: 'staged'` instead of `status: 'pending'`

**Example (create-registration-payment-intent/route.ts line ~1402):**
```typescript
// OLD
const { data: paymentRecord, error: paymentError } = await supabase
  .from('payments')
  .insert({
    user_id: user.id,
    total_amount: centsToCents(amount),
    discount_amount: centsToCents(discountAmount),
    final_amount: centsToCents(finalAmount),
    stripe_payment_intent_id: paymentIntent.id,
    status: 'pending',  // OLD
    payment_method: 'stripe',
  })

// NEW
const { data: paymentRecord, error: paymentError } = await supabase
  .from('payments')
  .insert({
    user_id: user.id,
    total_amount: centsToCents(amount),
    discount_amount: centsToCents(discountAmount),
    final_amount: centsToCents(finalAmount),
    stripe_payment_intent_id: paymentIntent.id,
    status: 'staged',  // NEW - awaiting user submission
    payment_method: 'stripe',
    submitted_at: null,  // NEW - not submitted yet
  })
```

**Special case: Off-session payments (waitlist/alternate)**

For off-session payments where `confirm: true` is used, set `submitted_at` immediately:

```typescript
// waitlist-payment-service.ts line ~258
const { data: paymentRecord, error: paymentError } = await supabase
  .from('payments')
  .insert({
    user_id: userId,
    total_amount: centsToCents(finalAmount),
    final_amount: centsToCents(finalAmount),
    stripe_payment_intent_id: paymentIntent.id,
    status: paymentIntent.status === 'succeeded' ? 'completed' : 'pending',
    payment_method: 'stripe',
    submitted_at: new Date().toISOString(),  // NEW - set immediately for off-session
    completed_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null
  })
```

#### Change 3: Update Refund Logic

**File:** `src/app/api/admin/refunds/route.ts`

**Change:** Update status check to allow refunds for 'pending' status (in case payment is processing)

```typescript
// OLD (line ~62)
if (payment.status !== 'completed') {
  return NextResponse.json(
    { error: 'Payment must be completed before it can be refunded' },
    { status: 400 }
  )
}

// NEW
if (!['completed', 'pending'].includes(payment.status)) {
  return NextResponse.json(
    { error: 'Payment must be completed or pending before it can be refunded' },
    { status: 400 }
  )
}
```

#### Change 4: Update Webhook Handler

**File:** `src/app/api/stripe-webhook/route.ts`

**Change:** Update `payment_intent.succeeded` handler to check for existing `submitted_at`

```typescript
// Line ~205 (payment_intent.succeeded handler)
// OLD
const { error: updateError } = await supabase
  .from('payments')
  .update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stripe_fee_amount: stripeFeeAmount,
    stripe_charge_id: chargeId
  })

// NEW
const now = new Date().toISOString()
const updateData: any = {
  status: 'completed',
  completed_at: now,
  updated_at: now,
  stripe_fee_amount: stripeFeeAmount,
  stripe_charge_id: chargeId
}

// If submitted_at not set (shouldn't happen for user-initiated, but safety check)
if (!payment.submitted_at) {
  updateData.submitted_at = now
}

const { error: updateError } = await supabase
  .from('payments')
  .update(updateData)
  .eq('stripe_payment_intent_id', paymentIntent.id)
```

### Phase 3: Frontend Changes

#### Change 1: Update Payment Confirmation Flow

**Files to modify:**
- Registration checkout component
- Membership checkout component
- Any component that calls `stripe.confirmPayment()`

**Example flow:**
```typescript
async function handlePaymentSubmit(event: FormEvent) {
  event.preventDefault()

  if (!stripe || !elements || !clientSecret) {
    return
  }

  setIsProcessing(true)

  try {
    // STEP 1: Mark payment as submitted (FAIL-FAST)
    const markResponse = await fetch('/api/mark-payment-submitted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentIntentId: clientSecret.split('_secret_')[0] // Extract PI ID from client secret
      })
    })

    if (!markResponse.ok) {
      const error = await markResponse.json()
      throw new Error(error.error || 'Failed to mark payment as submitted')
    }

    // STEP 2: Only proceed to Stripe if step 1 succeeded
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payment-success`,
      },
    })

    if (error) {
      // Payment failed - webhook will handle status update
      setErrorMessage(error.message || 'Payment failed')
    }
    // On success, user is redirected to return_url

  } catch (error) {
    console.error('Payment submission error:', error)
    setErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred')
  } finally {
    setIsProcessing(false)
  }
}
```

### Phase 4: Update Cleanup Scripts

**File:** `supabase/migrations/YYYY-MM-DD-cleanup-old-staged-records.sql` (UPDATE)

**Change:** Use new `staged` status for abandonment detection

```sql
-- OLD (checking updated_at = created_at)
UPDATE xero_invoices xi
SET
  sync_status = 'abandoned',
  sync_error = 'Automatically marked as abandoned - payment not submitted to Stripe within 10 minutes',
  updated_at = NOW()
FROM payments p
WHERE
  xi.sync_status = 'staged'
  AND xi.payment_id = p.id
  AND p.updated_at = p.created_at
  AND p.status = 'pending'
  AND xi.staged_at < NOW() - INTERVAL '10 minutes';

-- NEW (checking status = 'staged' and submitted_at IS NULL)
UPDATE xero_invoices xi
SET
  sync_status = 'abandoned',
  sync_error = 'Automatically marked as abandoned - payment not submitted within 10 minutes',
  updated_at = NOW()
FROM payments p
WHERE
  xi.sync_status = 'staged'
  AND xi.payment_id = p.id
  AND p.status = 'staged'
  AND p.submitted_at IS NULL
  AND xi.staged_at < NOW() - INTERVAL '10 minutes';
```

---

## Testing Checklist

### Unit Tests
- [ ] `/api/mark-payment-submitted` endpoint
  - [ ] Successfully marks payment as submitted
  - [ ] Returns success if already submitted (idempotency)
  - [ ] Returns error if payment not found
  - [ ] Handles invalid status gracefully
  - [ ] Fails fast if database update fails

### Integration Tests
- [ ] User-initiated registration payment
  - [ ] Payment created with `status: 'staged'`
  - [ ] Clicking "Pay" marks as `status: 'pending'`, sets `submitted_at`
  - [ ] Webhook updates to `status: 'completed'`, sets `completed_at`
- [ ] User-initiated membership payment (same flow as registration)
- [ ] Off-session waitlist payment
  - [ ] Payment created with `submitted_at` same as `created_at`
  - [ ] Status is 'pending' or 'completed' immediately
- [ ] Off-session alternate payment (same flow as waitlist)
- [ ] Free registration ($0)
  - [ ] Payment created with `status: 'completed'` immediately
  - [ ] `submitted_at` same as `completed_at`
- [ ] Free membership ($0) (same flow as free registration)
- [ ] Failed payment (card declined)
  - [ ] Payment marked as `status: 'pending'`, `submitted_at` set
  - [ ] Webhook updates to `status: 'failed'`
- [ ] Abandoned payment (user never clicks "Pay")
  - [ ] Payment remains `status: 'staged'`, `submitted_at: null`
  - [ ] Cleanup script marks as abandoned after 10 minutes
- [ ] Multiple submission attempts
  - [ ] Second call to `/api/mark-payment-submitted` returns success without error
  - [ ] `submitted_at` timestamp doesn't change on duplicate calls

### Manual Testing
- [ ] Complete end-to-end purchase flow
- [ ] Verify timestamps are logical: `created_at <= submitted_at <= completed_at`
- [ ] Test abandonment detection query returns correct results
- [ ] Verify refund flow still works with new status
- [ ] Check admin dashboards/reports show correct payment states

---

## Analytics Benefits

With `submitted_at` timestamp, we can now track:

1. **Abandonment rate by stage:**
   ```sql
   -- Users who saw payment form but never clicked "Pay"
   SELECT COUNT(*) FROM payments
   WHERE status = 'staged' AND submitted_at IS NULL

   -- Users who clicked "Pay" but payment failed
   SELECT COUNT(*) FROM payments
   WHERE submitted_at IS NOT NULL AND status IN ('failed', 'staged')
   ```

2. **Time to submit (how long users take to fill out payment form):**
   ```sql
   SELECT AVG(EXTRACT(EPOCH FROM (submitted_at - created_at))) as avg_seconds
   FROM payments
   WHERE submitted_at IS NOT NULL
   ```

3. **Time to complete (Stripe processing time):**
   ```sql
   SELECT AVG(EXTRACT(EPOCH FROM (completed_at - submitted_at))) as avg_seconds
   FROM payments
   WHERE status = 'completed'
   ```

4. **Conversion funnel:**
   - Payment intent created → X%
   - User clicked "Pay" → Y%
   - Payment completed → Z%

---

## Rollback Plan

If issues arise after deployment:

1. **Immediate rollback:**
   ```sql
   -- Revert status changes (set all 'staged' back to 'pending')
   UPDATE payments SET status = 'pending' WHERE status = 'staged';
   ```

2. **Frontend rollback:**
   - Remove call to `/api/mark-payment-submitted`
   - Frontend directly calls `stripe.confirmPayment()` as before

3. **Schema rollback** (if needed):
   ```sql
   -- Remove submitted_at column
   ALTER TABLE payments DROP COLUMN submitted_at;

   -- Revert status constraint
   ALTER TABLE payments DROP CONSTRAINT payments_status_check;
   ALTER TABLE payments ADD CONSTRAINT payments_status_check
   CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'cancelled'));
   ```

---

## Deployment Strategy

1. **Deploy schema changes first** (migrations 1-3)
   - Add `submitted_at` column
   - Add `'staged'` status
   - Backfill existing data
   - Verify migrations succeeded

2. **Deploy backend changes**
   - New API endpoint
   - Updated payment creation code
   - Updated webhook handler
   - Updated refund logic

3. **Deploy frontend changes**
   - Update checkout components to call new endpoint
   - Monitor for errors in production

4. **Monitor for 24-48 hours**
   - Check error rates in `/api/mark-payment-submitted`
   - Verify all payments are transitioning correctly
   - Check abandoned payment detection

5. **Deploy cleanup script updates**
   - Only after confirming new flow is working
   - Run manually first, then schedule as cron job

---

## Notes on xero_invoices Table

As discussed, `xero_invoices` does NOT need a `submitted_at` column. It has its own clear flow:

```
'staged' → Invoice created, payment not yet completed
'pending' → Payment completed, awaiting Xero sync
'synced' → Successfully synced to Xero
'failed' → Sync to Xero failed
'abandoned' → Payment abandoned or invoice stale
```

The `xero_invoices.updated_at` timestamp is sufficient for tracking when the invoice progresses through states.

---

## Future Considerations

### Potential Additional Enhancements
1. **Add `payment_attempt_count` column** to track retry attempts
2. **Add `last_attempt_at` timestamp** to track when user last tried to pay
3. **Add `abandonment_reason` field** to capture why payments were abandoned (user cancelled, timeout, etc.)
4. **Webhook for payment_intent.canceled** to explicitly mark payments as 'cancelled' status

### Monitoring & Alerts
- Alert if abandonment rate >20%
- Alert if time-to-submit >5 minutes (indicates UI issues)
- Alert if `/api/mark-payment-submitted` error rate >1%

---

## References

- Current payment flow: `src/app/api/create-registration-payment-intent/route.ts`
- Current webhook handler: `src/app/api/stripe-webhook/route.ts`
- Stripe webhook events: https://stripe.com/docs/webhooks
- Database schema: `supabase/schema.sql`
