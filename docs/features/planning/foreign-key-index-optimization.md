# Foreign Key Index Optimization

**Status**: 📋 Planning

## Summary

Supabase database linter identified 17 unindexed foreign keys. After analyzing query patterns across the codebase, 5 critical indexes were added immediately, and 12 remain for future consideration based on actual performance needs.

## Background

Foreign keys without covering indexes can cause performance issues when:
- JOIN operations are performed
- WHERE clauses filter by the foreign key column
- Foreign key constraint validation occurs on INSERT/UPDATE/DELETE

However, not all foreign keys need indexes. Indexes add storage overhead and slow down writes, so they should only be added when the query patterns justify them.

## Analysis Completed

A thorough analysis of the codebase examined:
- All API routes and database queries
- Admin pages and reporting functionality
- Registration, payment, and refund workflows
- Query frequency and table scan patterns

### Results: 5 High-Priority, 12 Low-Priority

## Phase 1: ✅ Completed (5 Critical Indexes Added)

The following indexes were added in migration `2025-10-28-add-critical-fk-indexes.sql`:

### 1. `user_registrations.registration_id`
**Priority**: Critical
**Reason**: Used in 25+ API routes to find all participants in a registration
**Query patterns**:
- Registration participant lists
- Capacity checks on every registration attempt
- Admin reporting dashboards
- Participant exports

**Files using this**:
- `/api/admin/reports/registrations/route.ts` - Line 47-54
- `/api/create-registration-payment-intent/route.ts` - Line 89-95
- `/api/alternate-registrations/route.ts` - Multiple queries
- Many more...

### 2. `user_registrations.registration_category_id`
**Priority**: Critical
**Reason**: Used to check category capacity on every registration attempt
**Query patterns**:
- Capacity management (`.eq('registration_category_id', categoryId)` appears 8+ times)
- Category-level reporting
- Waitlist selection based on category capacity

**Files using this**:
- `/api/admin/reports/registrations/route.ts` - Capacity counts
- `/api/registration-counts/[registrationId]/route.ts` - Real-time capacity
- `/api/waitlists/[waitlistId]/select/route.ts` - Capacity verification

### 3. `discount_usage.discount_code_id`
**Priority**: Critical
**Reason**: Used on every discounted payment to validate usage limits
**Query patterns**:
- Discount code validation (multiple checks per payment)
- Usage limit enforcement
- Usage tracking and reporting

**Files using this**:
- `/api/create-registration-payment-intent/route.ts` - Check existing usage
- `/api/confirm-registration-payment/route.ts` - Record usage
- `/api/validate-discount-code/route.ts` - Usage limit checks

### 4. `discount_usage.season_id`
**Priority**: High
**Reason**: Used to enforce per-season discount limits
**Query patterns**:
- Seasonal usage limit validation
- Season-specific discount rule enforcement

**Files using this**:
- `/api/validate-discount-code/route.ts` - Seasonal limit checks

### 5. `refunds.payment_id`
**Priority**: Critical
**Reason**: Used on every refund operation to look up history
**Query patterns**:
- Refund history lookups
- Available refund amount calculation
- Refund status validation

**Files using this**:
- `/api/admin/refunds/route.ts` - Check existing refunds (Line 78-82)
- `/api/admin/refunds/payment/[paymentId]/route.ts` - Refund history (Line 47-54)
- `/api/admin/refunds/preview/route.ts` - Calculate available amount (Line 69-73)

## Phase 2: 🔮 Deferred (12 Lower-Priority Indexes)

These foreign keys are currently **not** indexed. They can be added in the future if query patterns change or performance issues emerge.

### Medium Priority (Consider if usage increases)

#### `payments.refunded_by`
**Current usage**: Low - only stored for audit trail
**Query patterns**: Not actively filtered; refunds queried by `payment_id`, not by who processed them
**Add index if**: You build reports showing "refunds processed by admin X"
**Table**: `payments`

#### `registrations.season_id`
**Current usage**: Low - loaded via relationship, not direct filtering
**Query patterns**: Season info fetched via nested select, not used in WHERE clauses
**Add index if**: You build features that list/filter all registrations by season
**Table**: `registrations`

#### `user_registrations.user_membership_id`
**Current usage**: Low - set during registration creation, rarely queried
**Query patterns**: Mostly just stored; not used for filtering
**Add index if**: You build membership-based reporting that queries by this FK
**Table**: `user_registrations`

#### `alternate_selections.discount_code_id`
**Current usage**: Unknown - appears to be newly added feature
**Query patterns**: Minimal usage found in codebase
**Add index if**: Alternate selection feature sees heavy adoption
**Table**: `alternate_selections`

### Low Priority (Audit fields, rarely queried)

#### `access_codes.generated_by`
**Current usage**: Very low - audit trail only
**Query patterns**: No active queries found
**Add index if**: You need reports on "access codes generated by admin X"
**Table**: `access_codes`
**Note**: Access codes feature appears unused/legacy

#### `access_codes.registration_id`
**Current usage**: Very low - feature appears unused
**Query patterns**: No active queries found
**Add index if**: Access codes feature is revived and actively used
**Table**: `access_codes`

#### `access_code_usage.registration_id`
**Current usage**: Very low - feature appears unused
**Query patterns**: No active queries found
**Add index if**: Access codes feature is revived
**Table**: `access_code_usage`

#### `access_code_usage.user_id`
**Current usage**: Very low - feature appears unused
**Query patterns**: No active queries found
**Add index if**: Access codes feature is revived
**Table**: `access_code_usage`

#### `refunds.processed_by`
**Current usage**: Very low - audit field only
**Query patterns**: Not filtered in active code
**Add index if**: You build admin audit reports by processor
**Table**: `refunds`

#### `refunds.user_id`
**Current usage**: Very low - audit field only
**Query patterns**: Not filtered in active code
**Add index if**: You build user-facing refund history pages
**Table**: `refunds`

#### `registration_captains.assigned_by`
**Current usage**: Very low - audit field only
**Query patterns**: No active queries found
**Add index if**: You need reports on "assignments made by admin X"
**Table**: `registration_captains`

#### `waitlists.selected_by_admin_id`
**Current usage**: Low - audit field
**Query patterns**: Stored but not queried
**Add index if**: You build reports on "waitlist selections made by admin X"
**Table**: `waitlists`

## Performance Impact Assessment

### Without the 5 critical indexes:
- ❌ **Registration attempts** would scan entire `user_registrations` table to check capacity
- ❌ **Discount validation** would scan entire `discount_usage` table on every discounted payment
- ❌ **Refund operations** would scan entire `refunds` table multiple times
- ❌ **Admin reports** would perform slow full table scans for participant lists

### With the 5 critical indexes added:
- ✅ **Registration capacity checks** use index lookup (O(log n) instead of O(n))
- ✅ **Discount validation** uses index lookup for usage checks
- ✅ **Refund operations** quickly find payment history via index
- ✅ **Admin reports** load participant lists efficiently

### The 12 deferred indexes:
- Most are audit fields that store "who did this action" but are never queried
- Some are from unused/legacy features (access codes)
- Some are loaded via relationships, not direct filtering
- **Current impact**: Minimal to none - these query patterns don't exist in the codebase

## Implementation Status

### ✅ Completed
- Migration created: `2025-10-28-add-critical-fk-indexes.sql`
- 5 indexes added with detailed comments
- Tested and ready for deployment

### 🔮 Future Work
If query patterns change or new features are added that use the deferred FKs, revisit this document and create a follow-up migration. Signs to watch for:
- Slow query logs showing scans on these foreign key columns
- New features that filter/join by these columns
- Admin reports that need to query by "who performed action X"

## Migration Strategy

### For Future Index Additions
If you decide to add any of the deferred indexes:

```sql
-- Example: Add index for payments.refunded_by if needed
CREATE INDEX IF NOT EXISTS idx_payments_refunded_by
ON payments(refunded_by);

COMMENT ON INDEX idx_payments_refunded_by IS
'Speeds up queries that find all refunds processed by a specific admin. Added due to [reason].';
```

### Monitoring
Watch for these signs that an index might be needed:
1. Slow query logs showing sequential scans on FK columns
2. User complaints about slow report/list pages
3. Database CPU spikes correlating with specific query patterns
4. Supabase query analyzer showing high-cost scans

## Related Files

- Migration: `supabase/migrations/2025-10-28-add-critical-fk-indexes.sql`
- Supabase linter output: 17 unindexed foreign keys identified (production)
- Analysis: Full codebase review of query patterns (Oct 2025)

## References

- [Supabase: Unindexed Foreign Keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [PostgreSQL: Index Performance](https://www.postgresql.org/docs/current/indexes-intro.html)
- Internal analysis: Query pattern review across 50+ API routes
