# Refactor payment plans to xero_payments architecture

## Summary

This PR refactors the payment plan system from a separate `payment_plans` table to using the existing `xero_payments` table architecture. This consolidation simplifies the data model, improves maintainability, and fixes several critical bugs discovered during the refactoring process.

## Key Changes

### 🏗️ Architecture Refactor

**Migration to xero_payments table:**
- Consolidated payment plan data into `xero_payments` table using `payment_type` ('installment' vs 'full')
- Added `installment_number` and `planned_payment_date` columns
- Created `payment_plan_summary` view for aggregated queries
- Restricted view access to service_role only (used by admin APIs and cron jobs)

**Payment status flow:**
- `staged` → Initial state when payment plan is created
- `pending` → First payment ready to process
- `planned` → Future payments waiting for their scheduled date
- `processing` → Currently being charged
- `synced` → Successfully synced to Xero
- `cancelled` → Superseded by early payoff
- `failed` → Payment failed after max attempts

### 🐛 Critical Bug Fixes

**1. Accounting Accuracy - Installment Rounding**
- **Problem:** Math.round() could cause sum of installments to not equal invoice total
- **Example:** $100.01 ÷ 4 = 4 × $25.00 = $100.00 (lost 1 cent)
- **Solution:** Last installment absorbs rounding remainder ($25.00 + $25.00 + $25.00 + $25.01 = $100.01)
- **Test Coverage:** 6 comprehensive tests validate perfect totals for all edge cases

**2. Early Payoff Reliability & Accounting**
- **Problem 1:** Synchronous charge → DB update could lose payment on server crash
- **Problem 2:** Would create 3 xero_payments ($2500 each) but only 1 Stripe payment ($7500)
- **Solution:** Webhook-based flow with 'cancelled' status
  1. Cancel planned payments (set `sync_status = 'cancelled'`)
  2. Create single staged payment for full remaining balance
  3. Create payment record & charge Stripe
  4. Webhook updates staged payment to pending (guaranteed even on crash)

**3. Schema Mismatches - contact_id Column**
- Fixed 3 locations using non-existent `contact_id` column:
  - `hasOutstandingBalance()` in payment-plan-service
  - `getTotalOutstandingBalance()` in payment-plan-service
  - Early payoff API endpoint
- Now correctly extract from `staging_metadata->>'user_id'`

**4. Payment Plan Eligibility Check**
- Added missing `payment_plan_enabled` flag check in `canUserCreatePaymentPlan()`
- Users now require both admin approval AND saved payment method

### 🔧 Code Quality Improvements

**DRY Principle - Centralized Configuration:**
- Created `payment-plan-config.ts` with shared constants:
  - `PAYMENT_PLAN_INSTALLMENTS = 4`
  - `INSTALLMENT_INTERVAL_DAYS = 30`
  - `MAX_PAYMENT_ATTEMPTS = 3`
  - `RETRY_INTERVAL_HOURS = 24`
- Replaced all hardcoded values across 5 files
- Removed duplicate `MAX_PAYMENT_ATTEMPTS` definition

**Code Consolidation:**
- Extracted duplicate webhook payment status update logic into `updatePaymentPlanStatuses()` helper
- Removed hardcoded 4-payment check (now flexible for any installment count)
- Applied object shorthand syntax

**Null Safety:**
- Added null safety to 3 `staging_metadata` spread operations
- Prevents crashes when metadata is missing

**Performance:**
- Fixed N+1 query in `getUserPaymentPlans()` using joins instead of loops
- Single query now fetches payment plans with registration data

**Permissions:**
- Fixed permission mismatch: admin endpoints now use `createAdminClient()` to query restricted views
- Updated RLS policies to match actual access patterns

### 📝 Documentation

- Clarified comments about payment status transitions
- Updated comments to match implementation (payment_plan_enabled check)
- Added inline documentation for complex logic

### ✅ Testing

**New Tests:**
- Created `payment-plan-service.test.ts` with 6 tests for installment distribution
- Tests cover perfect divisions, rounding errors, edge cases, and metadata

**Fixed Tests:**
- Updated `user-payment-plans.test.ts` to mock `createAdminClient()`
- Updated early payoff test expectations for new error messages
- All payment plan tests updated for xero_payments architecture

**Results:**
- ✅ All 56 tests passing across 8 test suites

## Database Changes

**New Migration:** `2025-11-06-refactor-payment-plans-to-xero-payments.sql`
- Adds new columns to `xero_payments` table
- Creates `payment_plan_summary` view
- Drops old `payment_plans` and `payment_plan_transactions` tables
- Data migration skipped (development environment)

## Files Changed

### Core Service Layer
- `src/lib/services/payment-plan-service.ts` - Complete rewrite for xero_payments architecture
- `src/lib/services/payment-plan-config.ts` - **NEW** Centralized configuration

### API Routes
- `src/app/api/stripe-webhook/route.ts` - Updated for new architecture + early payoff webhook
- `src/app/api/cron/payment-plans/route.ts` - Process scheduled payments from xero_payments
- `src/app/api/user/payment-plans/early-payoff/route.ts` - Webhook-based early payoff flow
- `src/app/api/admin/payment-plans/route.ts` - Query payment_plan_summary view
- `src/app/api/admin/users/[id]/payment-plans/route.ts` - Query payment_plan_summary view
- `src/app/api/admin/payment-plans/process-manual/route.ts` - Testing endpoint

### Database
- `supabase/migrations/2025-11-06-refactor-payment-plans-to-xero-payments.sql` - Complete migration

### Tests
- `src/__tests__/services/payment-plan-service.test.ts` - **NEW** Rounding tests
- `src/__tests__/api/admin/user-payment-plans.test.ts` - Fixed mocking
- `src/__tests__/api/user/payment-plan-early-payoff.test.ts` - Updated for staging_metadata

## Breaking Changes

None - This is a backend refactor with no API contract changes. All existing endpoints continue to work with the same request/response formats.

## Deployment Notes

1. Run migration: `supabase migration up`
2. No data migration needed (development environment)
3. Production deployment would require careful data migration from old tables

## Related Issues

Addresses multiple Copilot review comments regarding:
- Code duplication
- Hardcoded values
- Null safety
- Performance optimization
- Schema mismatches
- Accounting accuracy

---

**All tests passing ✅** | **Ready for review**
