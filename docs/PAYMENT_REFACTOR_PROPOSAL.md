# Payment Processing Architecture Refactor

**Date**: 2025-07-12  
**Status**: Planning Phase  
**Goal**: Consolidate payment processing logic and eliminate duplicate code paths

## Current Architecture Issues

### 1. Dual Processing Paths
- **Sync APIs**: Handle payment confirmation with immediate emails/Xero sync
- **Webhooks**: Act as backup but duplicate the same processing
- **Result**: Code duplication and potential race conditions

### 2. Dual Sources of Truth
```sql
-- Two disconnected payment statuses
payments.status = 'completed'           -- Transaction level
user_memberships.payment_status = 'paid' -- Business record level

-- No foreign key linking them together!
```

### 3. Missing Email Confirmations
- Free memberships/registrations get Xero sync but **no emails**
- No webhook equivalent since Stripe doesn't send webhooks for $0

### 4. Discount Usage Tracking Gap
- ✅ Implemented for registrations (both paid/free)  
- ❌ Missing for membership purchases

### 5. Xero Sync Risk
- Current flow: Payment completes → Immediately sync to Xero → Record success/failure
- **Risk**: If Xero API is down, sync data is lost and requires manual recovery
- **Missing**: Robust staging system to ensure zero data loss

## Proposed Architecture

### Core Principle: Database Triggers for Consolidation

**Single Processing Logic**: Use PostgreSQL triggers to handle all post-payment actions regardless of how payment gets marked complete.

### Payment Flow Design

#### For Paid Purchases (amount > 0)
1. **Sync API** (immediate UX):
   ```typescript
   // Create user_membership/user_registration with payment_status = 'paid'
   // User sees active membership immediately on website
   ```

2. **Webhook** (async processing):
   ```typescript
   // Updates payments.status = 'completed'
   // Triggers database function for emails/Xero staging
   ```

#### For Free Purchases (amount = 0)
1. **Sync API** (immediate):
   ```typescript
   // Create user_membership/user_registration with:
   // payment_status = 'paid' AND amount_paid = 0
   // Immediately triggers database function for emails/Xero staging
   ```

### Database Trigger Architecture

```sql
-- Unified trigger function for both scenarios
CREATE OR REPLACE FUNCTION handle_completed_purchase()
RETURNS TRIGGER AS $$
BEGIN
  -- Emit notification for async processing
  PERFORM pg_notify('purchase_completed', 
    json_build_object(
      'type', TG_TABLE_NAME,
      'record_id', NEW.id,
      'user_id', NEW.user_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Free purchases: Trigger on business tables
CREATE TRIGGER membership_completed 
  AFTER INSERT OR UPDATE OF payment_status ON user_memberships
  FOR EACH ROW WHEN (NEW.payment_status = 'paid' AND NEW.amount_paid = 0)
  EXECUTE FUNCTION handle_completed_purchase();

CREATE TRIGGER registration_completed 
  AFTER INSERT OR UPDATE OF payment_status ON user_registrations  
  FOR EACH ROW WHEN (NEW.payment_status = 'paid' AND NEW.amount_paid = 0)
  EXECUTE FUNCTION handle_completed_purchase();

-- Paid purchases: Trigger on payments table
CREATE TRIGGER payment_completed
  AFTER UPDATE OF status ON payments
  FOR EACH ROW WHEN (NEW.status = 'completed' AND NEW.final_amount > 0)
  EXECUTE FUNCTION handle_completed_purchase();
```

### Application Layer (Async Processing)

```typescript
// Listen to PostgreSQL notifications
supabase
  .channel('purchase_notifications')
  .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
    // Handle purchase_completed notifications
    processPurchaseCompletion(payload)
  })

async function processPurchaseCompletion(notification) {
  // Phase 1: Always create staging records (immediate, never fails)
  await createXeroStagingRecords(notification)
  
  // Phase 2: Send confirmation emails
  await sendConfirmationEmail(notification)
  
  // Phase 3: Batch sync all pending Xero records
  await syncPendingXeroRecords()
  
  // Phase 4: Update discount usage tracking
  await updateDiscountUsage(notification)
}

async function createXeroStagingRecords(notification) {
  // Always insert to staging tables with 'pending' status
  await supabase.from('xero_invoices').insert({
    payment_id: notification.payment_id,
    sync_status: 'pending',
    invoice_data: invoicePayload
  })
  
  await supabase.from('xero_invoice_line_items').insert(lineItems)
  
  await supabase.from('xero_payments').insert({
    payment_id: notification.payment_id,
    sync_status: 'pending',
    payment_data: paymentPayload
  })
}

async function syncPendingXeroRecords() {
  // Process all records with sync_status = 'pending'
  const pendingInvoices = await getPendingXeroInvoices()
  const pendingPayments = await getPendingXeroPayments()
  
  // Batch sync to Xero API
  for (const invoice of pendingInvoices) {
    try {
      await syncInvoiceToXero(invoice)
      await markInvoiceAsSynced(invoice.id)
    } catch (error) {
      await markInvoiceAsFailed(invoice.id, error)
    }
  }
  
  for (const payment of pendingPayments) {
    try {
      await syncPaymentToXero(payment)
      await markPaymentAsSynced(payment.id)
    } catch (error) {
      await markPaymentAsFailed(payment.id, error)
    }
  }
}
```

## Benefits

### 1. Eliminates Code Duplication
- ✅ Single processing pipeline for all purchases
- ✅ No more separate logic in sync APIs and webhooks
- ✅ Consistent behavior regardless of payment path

### 2. Improves Reliability
- ✅ Database-level guarantees for core business logic
- ✅ Webhook becomes pure safety net
- ✅ Atomic operations prevent partial state

### 3. Fixes Missing Features
- ✅ Free purchases get email confirmations
- ✅ Unified discount usage tracking
- ✅ Consistent Xero sync for all payment types

### 4. Better UX
- ✅ Immediate user feedback (membership shows as active)
- ✅ Async processing doesn't block UI
- ✅ No duplicate processing concerns

### 5. Zero Data Loss Xero Integration
- ✅ **Always create staging records first** - never lose invoice/payment data
- ✅ **Batch processing** - efficient sync of multiple records
- ✅ **Admin recovery** - manual retry of failed syncs from admin interface
- ✅ **Robust error handling** - failed syncs don't affect payment processing

## Implementation Steps

1. **Create database triggers** for purchase completion
2. **Set up PostgreSQL NOTIFY/LISTEN** system
3. **Refactor sync APIs** to only create business records
4. **Update webhook logic** to only handle payment status
5. **Implement Xero staging-first approach**:
   - Always insert to `xero_invoices` (sync_status: 'pending')
   - Always insert to `xero_invoice_line_items` 
   - Always insert to `xero_payments` (sync_status: 'pending')
   - Batch sync all pending records after staging
6. **Move email logic** to async processor
7. **Add discount usage tracking** for memberships
8. **Enhance admin interface** for manual Xero sync recovery
9. **Test both paid and free purchase flows**

## Risk Mitigation

### Backward Compatibility
- Keep existing endpoints functional during transition
- Gradual migration with feature flags
- Comprehensive testing of both old and new flows

### Database Performance
- Triggers are lightweight (just NOTIFY)
- Heavy processing moved to application layer
- Monitor trigger execution times

### Error Handling
- Async processing failures don't affect payment success
- Retry mechanisms for email/Xero operations
- Comprehensive logging and monitoring

## Xero Staging Enhancement Details

### Two-Phase Xero Processing

**Phase 1: Staging (Always succeeds)**
```typescript
// Triggered by payment completion webhook
await createXeroStagingRecords({
  payment_id,
  user_id,
  invoice_data: {...},
  line_items: [...],
  payment_data: {...}
})
```

**Phase 2: Batch Sync (Retryable)**
```typescript
// Process all sync_status = 'pending' records
await syncPendingXeroRecords()
```

### Admin Interface Enhancements

**New Admin Features**:
- **Unsynced Records Dashboard**: View all pending invoices and payments
- **Manual Sync Buttons**: Retry specific failed records
- **Bulk Retry**: Process all pending records at once
- **Sync History**: View detailed logs of sync attempts
- **Status Overview**: Quick stats on pending/synced/failed records

### Xero Sync Status Flow
```
pending → synced (success)
pending → failed (retry available)
failed → pending (admin retry)
```

## Implementation Decisions

### 1. Foreign Key Relationships ✅ **Feasible**
**Option A**: Add `payment_id` to business tables
```sql
ALTER TABLE user_memberships ADD COLUMN payment_id UUID REFERENCES payments(id);
ALTER TABLE user_registrations ADD COLUMN payment_id UUID REFERENCES payments(id);
```

**Option B**: Use existing `stripe_payment_intent_id` as natural key
- Both tables already have this field
- Links to `payments.stripe_payment_intent_id`
- NULL for free purchases (could use a generated ID)

**Recommendation**: Option A provides cleaner relationships and handles free purchases better.

### 2. Migration Strategy ✅ **Not needed**
- System not in production yet
- Fresh implementation without legacy concerns

### 3. Processing Architecture ✅ **Hybrid Approach Selected**

**Selected: Option C - Triggers + Scheduled Processing**
- ✅ Immediate processing attempt via triggers
- ✅ Fallback batch processing for failures  
- ✅ Simple implementation, no external dependencies
- ✅ No persistent connections needed
- ✅ Guarantees nothing gets missed (the whole point!)

**Implementation Flow**:
1. **Trigger fires** → Attempts immediate async processing
2. **If successful** → Records processed, done
3. **If fails** → Records remain in 'pending' state
4. **Batch processor** → Periodically retries all 'pending' records

### 4. Implementation Timeline ✅ **Ready to start**
- Implement in feature branch: `feature/payment-refactor`
- Allows testing without affecting main development

### 5. Automated Retry Strategy ✅ **Timer-based approach**
```typescript
// Client-side retry logic (no cron needed)
setInterval(async () => {
  if (hasFailedXeroRecords()) {
    await retryFailedXeroSyncs()
  }
}, 5 * 60 * 1000) // Every 5 minutes

// Or trigger on admin page load
useEffect(() => {
  checkAndRetryFailedSyncs()
}, [])
```
- No Vercel cron job required
- Runs when application is active
- Admin dashboard can trigger manual retries

## Next Steps

- [ ] Validate approach with small prototype
- [ ] Design detailed migration plan
- [ ] Create test cases for all scenarios
- [ ] Begin implementation with feature flags