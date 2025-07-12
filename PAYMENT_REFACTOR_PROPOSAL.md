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
   // Triggers database function for emails/Xero
   ```

#### For Free Purchases (amount = 0)
1. **Sync API** (immediate):
   ```typescript
   // Create user_membership/user_registration with:
   // payment_status = 'paid' AND amount_paid = 0
   // Immediately triggers database function for emails/Xero
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
  // Send confirmation emails
  // Sync to Xero
  // Update discount usage tracking
  // Any other external integrations
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

## Implementation Steps

1. **Create database triggers** for purchase completion
2. **Set up PostgreSQL NOTIFY/LISTEN** system
3. **Refactor sync APIs** to only create business records
4. **Update webhook logic** to only handle payment status
5. **Move email/Xero logic** to async processor
6. **Add discount usage tracking** for memberships
7. **Test both paid and free purchase flows**

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

## Open Questions

1. Should we add foreign keys linking `payments` to `user_memberships`/`user_registrations`?
2. How to handle existing payments that need migration?
3. Should we implement a job queue system instead of direct NOTIFY/LISTEN?
4. Timeline for implementing this refactor?

## Next Steps

- [ ] Validate approach with small prototype
- [ ] Design detailed migration plan
- [ ] Create test cases for all scenarios
- [ ] Begin implementation with feature flags