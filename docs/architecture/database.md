# Database Architecture & Design Decisions

## Overview
This document explains the database design patterns, architectural decisions, and trade-offs made in the Hockey Association Membership System, including the Xero accounting integration.

## Core Design Philosophy
The database balances **normalization principles** with **practical development needs**, choosing patterns that optimize for:
- Developer productivity and maintainability
- Query performance for common use cases
- Flexibility for future feature additions
- Clear data relationships and audit trails

## Key Design Patterns

### 1. Polymorphic Associations in Payment System

**Pattern Used:** `payment_items` table with `item_type` + `item_id` fields

```sql
payment_items (
  item_type: 'membership' | 'registration'  -- discriminator
  item_id: UUID                            -- points to memberships.id OR registrations.id
  amount: INTEGER                          -- amount for this specific item
)
```

**Why This Pattern:**
- **Simplicity:** Direct relationship to source data without wrapper tables
- **Flexibility:** Easy to add new purchasable item types
- **Performance:** Fewer joins to access purchase details
- **Practicality:** Small, stable set of item types (memberships, registrations)

**Alternative Considered:** Fully normalized approach with separate `item_types` and `items` tables
**Trade-off:** Lost foreign key constraints, gained simplicity and performance

**When to Use Polymorphic:**
- ✅ Small set of known types (2-5)
- ✅ Different schemas per type
- ✅ Direct access to source records needed
- ✅ Rapid development priorities

### 2. Flexible Membership Model

**Pattern Used:** Duration-based memberships with date ranges

```sql
user_memberships (
  valid_from: DATE
  valid_until: DATE
  months_purchased: INTEGER
  -- No unique constraint on (user_id, membership_id)
)
```

**Design Decision:** Allow multiple records per user per membership type to support:
- Membership extensions and renewals
- Smart date calculation (no gaps or overlaps)
- Complete purchase audit trail
- Different pricing for different purchase periods

**Alternative Considered:** Single record per user per membership with updates
**Trade-off:** Lost simple audit trail, gained extension flexibility

### 4. Account Deletion & Data Preservation

**Pattern Used:** Orphaned user records with independent authentication lifecycle

```sql
-- NO foreign key constraint between users and auth.users
users (
  id: UUID PRIMARY KEY  -- matches auth.users.id when active
  member_id: INTEGER UNIQUE -- auto-generated member ID starting from 1000
  deleted_at: TIMESTAMP -- marks when account was deleted
  -- business data preserved even after auth.users deletion
)
```

**Design Decision:** Completely decouple authentication from business data to enable:
- Privacy-compliant account deletion (GDPR compliance)
- Complete authentication prevention (no OAuth bypass)
- Business data preservation (payments, memberships, audit trails)
- Clean re-registration capability (same email, fresh account)

**How It Works:**
1. **Account Deletion:** Delete auth.users record entirely, anonymize public.users record
2. **Authentication Prevention:** No auth.users = no login via any method (email, OAuth, magic links)
3. **Data Preservation:** Business data remains in "orphaned" public.users record
4. **Re-registration:** Same email can create new auth.users with different UUID

**Alternative Considered:** Foreign key constraint with CASCADE deletion
**Trade-off:** Lost referential integrity, gained flexible account lifecycle management

**When to Use Orphaned Records:**
- ✅ Need to preserve business data after user deletion
- ✅ Regulatory compliance requirements (GDPR, audit trails)
- ✅ Re-registration with same email required
- ✅ Authentication and business data have different lifecycles

### 3. Hybrid Category System

**Pattern Used:** Combination of standard and custom categories

```sql
registration_categories (
  category_id: UUID REFERENCES categories(id)  -- NULL for custom
  custom_name: TEXT                           -- NULL for standard
  -- Constraint: exactly one must be non-NULL
)
```

**Why Hybrid:**
- **Standardization:** Common categories (Player, Goalie) across registrations
- **Flexibility:** Custom categories for unique situations
- **User Experience:** Dropdown with presets + custom option
- **Data Quality:** Prevents category sprawl while allowing exceptions

## Table Relationships

### Core Entities
- `auth.users` ↔ `users` (1:1 when active, orphaned when deleted)
- `users` → `user_memberships` (1:many)
- `memberships` → `user_memberships` (1:many)
- `seasons` → `registrations` (1:many)

### User Attributes
The `users` table includes attributes for registration filtering and team organization:
- `is_goalie`: Boolean indicating if user plays goalie (required, defaults to false)
- `is_lgbtq`: Boolean indicating LGBTQ identity (nullable for "prefer not to answer")
- `tags`: Array of custom tags for additional categorization

These attributes are collected during onboarding and can be updated through the profile editing interface. They're displayed as color-coded tags in the user interface and can be used for registration filtering and team organization.

### Payment System
- `users` → `payments` (1:many)
- `payments` → `payment_items` (1:many)
- `payment_items` → `memberships|registrations` (polymorphic)

### Registration System
- `registrations` → `registration_categories` (1:many)
- `categories` → `registration_categories` (1:many, optional)
- `registration_categories` → `user_registrations` (1:many)

### Payment Tracking in User Registrations

**Pattern Used:** Dual price tracking for discount support

```sql
user_registrations (
  registration_fee: INTEGER    -- Original/catalog price in cents
  amount_paid: INTEGER        -- Actual amount charged in cents
)
```

**Design Decision:** Track both original pricing and final amount to support:
- **Audit trails:** Complete record of original pricing vs discounts applied
- **Revenue analytics:** Ability to calculate total discounts given
- **Promotional reporting:** Track effectiveness of discount codes and early bird pricing
- **Future discount systems:** Schema ready for complex promotion systems

**Field Definitions:**
- **`registration_fee`**: The base price from `registration_categories.price` before any discounts
- **`amount_paid`**: The actual amount processed through Stripe (after discounts, codes, etc.)

**Discount Calculation:**
```sql
-- Total discount amount given
SELECT registration_fee - amount_paid AS discount_amount
FROM user_registrations;

-- Discount percentage  
SELECT ROUND(((registration_fee - amount_paid)::DECIMAL / registration_fee) * 100, 2) AS discount_percent
FROM user_registrations;
```

**Current State:** Both fields contain the same value since discount codes aren't implemented yet, but the structure supports future discount functionality without schema changes.

## Security Model

### Row Level Security (RLS)
All tables use RLS with policies ensuring:
- Users can only access their own data
- Admins can access all data (verified via `users.is_admin = true`)
- Public read access for reference data (seasons, memberships, registrations)

**Critical Security Note:** All admin operations are properly restricted to users with `is_admin = true`. Any policy allowing access based solely on authentication (`auth.uid() IS NOT NULL`) without admin verification is a security vulnerability.

### Payment Security
- Payment operations require authentication
- Stripe handles sensitive payment data (PCI compliance)
- Local database stores only metadata and status

### API-First Database Access (Architectural Principle)

**Preferred Pattern:** All database operations should go through Next.js API routes rather than direct client-side queries.

**Why API-First:**
- **Enhanced Security:** Server-side validation and authorization before database access
- **Centralized Business Logic:** Complex operations handled in controlled server environment
- **Better Error Handling:** Consistent error responses and logging
- **Easier Testing:** Business logic in testable API endpoints
- **Future Flexibility:** API layer can evolve without breaking client implementations
- **Performance Control:** Server can optimize queries and implement caching

**Examples:**
```typescript
// ✅ PREFERRED: API route with server-side logic
export default async function handler(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Server-side authorization
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  // Business logic and validation
  const result = await processBusinessLogic(user, req.body)
  return NextResponse.json(result)
}

// ❌ AVOID: Direct client-side database queries
const { data } = await supabase.from('table').select('*')
```

**When to Use Direct Client Queries:**
- Simple, read-only operations for public data
- Real-time subscriptions for UI updates
- Basic user profile updates

**When to Use API Routes:**
- Complex business logic operations
- Multi-table transactions
- Admin operations requiring authorization
- Payment processing and financial operations
- Data validation and transformation

## Performance Considerations

### Indexes
- Membership validity queries: `idx_user_memberships_validity`
- Membership type queries: `idx_user_memberships_membership_type`
- Payment lookups by Stripe ID for webhook processing
- Deleted user queries: `idx_users_deleted_at`
- Member ID lookups: `idx_users_member_id`
- User attribute filtering: `idx_users_is_lgbtq`, `idx_users_is_goalie`

### Query Patterns
Database schema optimized for common queries:
- User's active memberships (validity date range checks)
- Registration eligibility (membership requirement checks)
- Payment reconciliation (Stripe ID lookups)
- Account deletion filtering (`WHERE deleted_at IS NULL`)
- Orphaned user record identification (`WHERE deleted_at IS NOT NULL`)
- User attribute filtering for registration and team organization

## Data Integrity

### Constraints
- Date validations: `valid_until > valid_from`
- Payment status enums: `'pending' | 'paid' | 'refunded'`
- Pricing logic: `price_annual <= price_monthly * 12`

### Intentionally Relaxed Constraints
- **No foreign key from users.id to auth.users.id**: Enables account deletion with data preservation
- **Polymorphic payment_items**: No formal foreign keys for flexibility
- **Application-level relationship management**: More flexible than database constraints for complex business logic

### Business Logic
- Smart membership extension (application-level)
- Category-level membership requirements
- Capacity management with overflow to waitlists

### Advanced Discount System Architecture

**Pattern Used:** Category-based discount codes with per-category usage limits and accounting integration.

**Design Decision:** Two-tier system with discount categories containing multiple discount codes for organizational flexibility and financial reporting.

```sql
-- Discount Categories: Organizational groupings with accounting codes
discount_categories (
  id: uuid PRIMARY KEY
  name: text NOT NULL                           -- "Scholarship Fund", "Board Member", "Captain", "Volunteer"
  accounting_code: text NOT NULL                -- For Xero integration ("DISCOUNT-SCHOLAR", "DISCOUNT-BOARD")
  max_discount_per_user_per_season: integer     -- In cents, NULL = no limit (e.g., $500 = 50000)
  is_active: boolean DEFAULT true
  description: text                             -- Optional description
  created_at: timestamp
)

-- Discount Codes: Individual codes within categories
discount_codes (
  id: uuid PRIMARY KEY
  discount_category_id: uuid REFERENCES discount_categories(id)
  code: text UNIQUE NOT NULL                    -- "PRIDE100", "PRIDE75", "PRIDE50", "PRIDE25"
  percentage: decimal(5,2) NOT NULL             -- 100.00, 75.00, 50.00, 25.00
  is_active: boolean DEFAULT true
  valid_from: timestamp
  valid_until: timestamp
  created_at: timestamp
)

-- Discount Usage: Track usage against category limits
discount_usage (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  discount_code_id: uuid REFERENCES discount_codes(id)
  discount_category_id: uuid REFERENCES discount_categories(id)  -- Denormalized for fast queries
  season_id: uuid REFERENCES seasons(id)
  amount_saved: integer NOT NULL                -- In cents
  used_at: timestamp NOT NULL
  registration_id: uuid REFERENCES registrations(id)
)
```

**Business Rules:**
```sql
-- Validate per-user, per-category, per-season limits
SELECT SUM(amount_saved) as total_used 
FROM discount_usage 
WHERE user_id = ? AND discount_category_id = ? AND season_id = ?;

-- Check against category.max_discount_per_user_per_season
-- Reject if total_used + new_discount > category_limit
```

**Why This Pattern:**
- **Organizational Clarity:** Group related codes by purpose (Scholarship, Board, Captain, Volunteer)
- **Financial Integration:** Each category maps to specific accounting code for Xero reporting
- **Flexible Usage Limits:** Different limits per category (e.g., Scholarship $500/season, Board unlimited)
- **Admin Efficiency:** Bulk create related codes (PRIDE100, PRIDE75, PRIDE50, PRIDE25) under one category
- **Analytics Ready:** Track discount effectiveness by organizational purpose

**Example Usage:**
- **Scholarship Fund Category** (accounting_code: "DISCOUNT-SCHOLAR", limit: $500/season)
  - PRIDE100 (100% discount)
  - PRIDE75 (75% discount) 
  - PRIDE50 (50% discount)
  - PRIDE25 (25% discount)
- **Board Member Category** (accounting_code: "DISCOUNT-BOARD", limit: unlimited)
  - BOARD50 (50% discount)
  - BOARD100 (100% discount)

**Alternative Considered:** Single discount_codes table with individual limits
**Trade-off:** Lost organizational grouping and accounting integration, gained simpler schema

### 10. Member ID System for External Integration

**Pattern Used:** Auto-generated sequential member IDs for unique identification in external systems

```sql
-- Member ID sequence starting from 1000
CREATE SEQUENCE member_id_seq START 1000;

-- Auto-generated member IDs
users (
  member_id: INTEGER UNIQUE   -- Auto-generated: 1000, 1001, 1002, etc.
  -- Automatically assigned via trigger on INSERT
)

-- Trigger function for auto-generation
CREATE TRIGGER set_member_id_trigger
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_member_id_on_insert();
```

**Why This Pattern:**
- **External System Integration:** Provides human-readable IDs for Xero contacts
- **Uniqueness Guarantee:** Sequential IDs prevent duplicate name conflicts
- **Professional Appearance:** Clean format like "David Wender - 1000"
- **Scalability:** Supports unlimited growth starting from 1000
- **Backward Compatibility:** Existing users get IDs retroactively

**Xero Integration Benefits:**
```sql
-- Contact names in Xero become unique and traceable
"David Wender - 1000"     -- Member ID 1000
"David Wender - 1001"     -- Different member with same name
"John Smith - 1002"       -- Member ID 1002
```

**Design Decision:** Start from 1000 instead of 1 to:
- Provide professional appearance (4-digit minimum)
- Reserve space for system/test accounts if needed
- Allow for future organizational numbering schemes

**Alternative Considered:** Using UUID or email-based identification
**Trade-off:** Lost human readability, gained guaranteed uniqueness and external system compatibility

## Payment Processing Architecture Refactor (2025-07-12)

### 11. Unified Payment Processing with Database Triggers

**Pattern Used:** Database trigger-driven async processing with staging-first Xero integration

**Problem Solved:** Eliminated dual processing paths between sync APIs and webhooks, ensuring zero data loss for external integrations.

```sql
-- Enhanced business tables with payment relationships
user_memberships (
  payment_id: UUID REFERENCES payments(id)     -- Links to payment record
  -- ... existing fields
)

user_registrations (
  payment_id: UUID REFERENCES payments(id)     -- Links to payment record
  -- ... existing fields  
)

-- Unified trigger function for all payment completions
CREATE OR REPLACE FUNCTION notify_payment_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Emit PostgreSQL notification for async processing
  PERFORM pg_notify('payment_completed', json_build_object(
    'event_type', TG_TABLE_NAME,
    'record_id', NEW.id,
    'user_id', NEW.user_id,
    'payment_id', CASE WHEN TG_TABLE_NAME = 'payments' THEN NEW.id ELSE NEW.payment_id END,
    'amount', CASE 
      WHEN TG_TABLE_NAME = 'payments' THEN NEW.final_amount
      ELSE COALESCE(NEW.amount_paid, 0)
    END,
    'trigger_source', TG_TABLE_NAME,
    'timestamp', NOW()
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for different payment completion scenarios
CREATE TRIGGER payment_completed_trigger           -- Paid purchases
  AFTER UPDATE OF status ON payments
  FOR EACH ROW WHEN (OLD.status != 'completed' AND NEW.status = 'completed' AND NEW.final_amount > 0)
  EXECUTE FUNCTION notify_payment_completion();

CREATE TRIGGER membership_completed_trigger        -- Free memberships  
  AFTER INSERT OR UPDATE OF payment_status ON user_memberships
  FOR EACH ROW WHEN (NEW.payment_status = 'paid' AND COALESCE(NEW.amount_paid, 0) = 0)
  EXECUTE FUNCTION notify_payment_completion();

CREATE TRIGGER registration_completed_trigger      -- Free registrations
  AFTER INSERT OR UPDATE OF payment_status ON user_registrations  
  FOR EACH ROW WHEN (NEW.payment_status = 'paid' AND COALESCE(NEW.amount_paid, 0) = 0)
  EXECUTE FUNCTION notify_payment_completion();
```

**Architecture Benefits:**
- **Single Processing Pipeline:** Unified logic for paid and free purchases
- **Hybrid Processing:** Immediate attempt + batch fallback for reliability
- **Zero Data Loss:** Staging-first approach for external integrations
- **No Code Duplication:** Eliminates separate sync API and webhook logic

### 12. Staging-First Xero Integration

**Pattern Used:** Always create staging records before attempting external API sync

**Enhanced Xero Tables:**
```sql
-- Enhanced with staging capabilities
xero_invoices (
  sync_status: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
  staged_at: TIMESTAMP WITH TIME ZONE           -- When staged for sync
  staging_metadata: JSONB                       -- Validation and context data
  -- ... existing fields
)

xero_payments (
  sync_status: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'  
  staged_at: TIMESTAMP WITH TIME ZONE           -- When staged for sync
  staging_metadata: JSONB                       -- Validation and context data
  -- ... existing fields
)

-- Staging-optimized indexes
CREATE INDEX idx_xero_invoices_staging ON xero_invoices(sync_status, staged_at) 
  WHERE sync_status IN ('pending', 'staged');
CREATE INDEX idx_xero_payments_staging ON xero_payments(sync_status, staged_at)
  WHERE sync_status IN ('pending', 'staged');
```

**Processing Flow:**
```typescript
// Phase 1: Always create staging records (never fails)
await createXeroStagingRecords(paymentData)

// Phase 2: Send confirmation emails  
await sendConfirmationEmails(paymentData)

// Phase 3: Batch sync all pending Xero records
await syncPendingXeroRecords()

// Phase 4: Update discount usage tracking
await updateDiscountUsage(paymentData)
```

**Why This Pattern:**
- **Guaranteed Data Capture:** Staging always succeeds, external API failures don't lose data
- **Admin Recovery:** Manual retry of failed syncs from admin interface
- **Batch Efficiency:** Process multiple records together for better performance
- **Clean Separation:** Payment success never depends on external API status

### 13. Hybrid Payment Completion Strategy

**Architecture:** Combines immediate user feedback with reliable async processing

**Sync API Flow (Immediate UX):**
```typescript
// 1. Create business records with payment_status = 'paid'
// 2. User sees "Membership Active!" immediately
// 3. Return success to close payment form
```

**Async Processing Flow (Reliable):**
```typescript
// 1. Database trigger fires on payment_status = 'paid'
// 2. PostgreSQL notification sent via pg_notify()
// 3. Application listener processes: emails, Xero, discount tracking
// 4. Webhook provides safety net if sync API fails
```

**Benefits:**
- **Fast User Experience:** Immediate feedback on payment completion
- **Reliable Processing:** Async operations don't block user interface
- **Webhook Safety Net:** Catches payments if sync API fails
- **No Duplicate Processing:** Idempotent checks prevent double-execution

### 14. Payment Record Relationships

**Foreign Key Strategy:** Direct links from business records to payment transactions

```sql
-- Establishes clear payment relationships
user_memberships.payment_id → payments.id
user_registrations.payment_id → payments.id

-- Enables payment tracking queries
SELECT u.*, p.final_amount, p.status 
FROM user_memberships u
LEFT JOIN payments p ON u.payment_id = p.id
WHERE u.user_id = ?;
```

**Design Decision:** Added nullable foreign keys rather than using existing `stripe_payment_intent_id`
- **Benefits:** Handles free purchases, cleaner relationships, better type safety
- **Migration:** Backward compatible (nullable), existing code continues working

### 15. Email Processing Architecture

**Pattern Used:** Move email sending from sync APIs to async triggers

**Before:** Email sent immediately in sync API (blocks user, fails if email API down)
**After:** Email sent async via trigger (fast user response, reliable delivery)

```typescript
// Sync API (fast response)
await createMembershipRecord({ payment_status: 'paid' })
return { success: true, membership_id }

// Async trigger (reliable processing) 
→ Database trigger fires
→ Email sent via trigger processor
→ Handles API failures gracefully
```

**Benefits for Zero-Dollar Purchases:**
- Free memberships/registrations now send confirmation emails
- Previously missing feature due to no Stripe webhook for $0
- Unified email flow for all purchase types

### Migration History

**2025-07-12 Payment Refactor Migrations:**
1. `add-payment-foreign-keys.sql` - Added payment_id columns to business tables
2. `enhance-xero-staging.sql` - Added staging fields and enhanced sync_status enums  
3. `add-payment-triggers.sql` - Created unified trigger system for payment completion

**Backward Compatibility:** All migrations are purely additive
- Existing code continues working unchanged
- New features can be enabled incrementally via feature flags
- No breaking changes to current payment flows

### 16. Payment Plans for Registrations (2025-11 Refactor)

**Pattern Used:** Consolidated into `xero_payments` table using `payment_type='installment'`

**Design Decision:** Four-installment payment system (25% each) with monthly intervals, admin-controlled user eligibility, and automated off-session payment processing. Refactored from separate tables to use existing payment infrastructure.

```sql
-- User eligibility flag
users (
  payment_plan_enabled: BOOLEAN DEFAULT FALSE  -- Admin-controlled eligibility
)

-- Invoice flagging for payment plans
xero_invoices (
  is_payment_plan: BOOLEAN DEFAULT FALSE       -- Marks invoice as part of payment plan
  -- ... existing fields
)

-- Unified payment tracking (used for both regular and installment payments)
xero_payments (
  -- Existing fields
  xero_invoice_id: UUID REFERENCES xero_invoices(id)
  amount_paid: INTEGER NOT NULL                -- Amount in cents
  sync_status: TEXT CHECK (sync_status IN ('pending', 'staged', 'planned', 'cancelled', 'processing', 'synced', 'failed', 'ignore'))

  -- Payment plan specific fields
  payment_type: TEXT CHECK (payment_type IN ('full', 'installment'))
  installment_number: INTEGER                  -- Which installment (1-4)
  planned_payment_date: DATE                   -- Scheduled payment date
  attempt_count: INTEGER DEFAULT 0             -- Number of payment attempts
  last_attempt_at: TIMESTAMP WITH TIME ZONE    -- Last retry attempt
  failure_reason: TEXT                         -- Failure details

  -- NO UNIQUE(xero_invoice_id, tenant_id) constraint - allows multiple payments per invoice
)

-- Aggregated view for payment plan queries
CREATE OR REPLACE VIEW payment_plan_summary AS
SELECT
  xi.id as invoice_id,
  (xi.staging_metadata->>'user_id')::uuid as contact_id,
  COUNT(*) FILTER (WHERE xp.payment_type = 'installment') as total_installments,
  SUM(xp.amount_paid) FILTER (WHERE xp.sync_status IN ('synced','pending','processing')) as paid_amount,
  SUM(xp.amount_paid) as total_amount,
  COUNT(*) FILTER (WHERE xp.sync_status IN ('synced','pending','processing') AND xp.payment_type = 'installment') as installments_paid,
  CASE
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'planned') = 0 THEN 'completed'
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'failed') > 0 THEN 'failed'
    ELSE 'active'
  END as status
FROM xero_invoices xi
JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
WHERE xi.is_payment_plan = true
GROUP BY xi.id, xi.staging_metadata;
```

**Why This Pattern (Consolidated Architecture):**
- **Simplified Data Model:** Single source of truth for all payments (regular and installment)
- **Consistent Processing:** Same infrastructure handles both payment types
- **Better Xero Integration:** Natural mapping to Xero's invoice + multiple payments model
- **Reduced Code Duplication:** Shared payment processing and sync mechanisms
- **User Accessibility:** Enables installment payments for expensive registrations
- **Admin Control:** Payment plan eligibility managed per-user by administrators
- **Automated Processing:** Off-session Stripe payments with automatic retry logic
- **Registration Protection:** Registration remains valid even if future payments fail
- **Early Payoff:** Webhook-based flow for reliable early payoff processing

**Business Rules:**
```sql
-- Payment plan eligibility requirements:
-- 1. User must have payment_plan_enabled = true (admin controlled)
-- 2. User must have saved payment method (for off-session charges)
-- 3. Registration must be eligible for payment plans

-- Installment schedule:
-- - Payment 1: Immediate (during registration checkout)
-- - Payment 2: 30 days after Payment 1
-- - Payment 3: 30 days after Payment 2
-- - Payment 4: 30 days after Payment 3

-- Payment status flow:
-- - staged → Initial state when payment plan created (all installments)
-- - pending → First payment ready to process (after first payment completes)
-- - planned → Future payments waiting for scheduled date
-- - processing → Currently being charged
-- - synced → Successfully synced to Xero
-- - cancelled → Superseded by early payoff
-- - failed → Payment failed after max attempts

-- Retry logic for failed payments:
-- - Attempt 1: Initial scheduled payment
-- - Attempt 2: 24 hours after Attempt 1
-- - Attempt 3: 24 hours after Attempt 2
-- - After 3 failed attempts: Mark as failed, notify user
-- - Max attempts and retry interval configurable via payment-plan-config.ts
```

**Xero Integration:**
```sql
-- Single invoice created for full registration amount
-- Payments recorded as partial payments against the invoice
-- Example for $100 registration with payment plan:
--   Invoice: $100 (AUTHORISED)
--   Payment 1: $25 (immediate)
--   Payment 2: $25 (30 days)
--   Payment 3: $25 (60 days)
--   Payment 4: $25 (90 days)
```

**Performance Optimizations:**
```sql
-- Index for eligible users query
CREATE INDEX idx_users_payment_plan_enabled ON users(payment_plan_enabled)
  WHERE payment_plan_enabled = true;

-- Index for cron job processing (planned payments due for processing)
CREATE INDEX idx_xero_payments_planned_ready
  ON xero_payments(sync_status, planned_payment_date)
  WHERE sync_status = 'planned' AND planned_payment_date IS NOT NULL;

-- Index for payment type queries
CREATE INDEX idx_xero_payments_payment_type ON xero_payments(payment_type);

-- Index for installment lookups
CREATE INDEX idx_xero_payments_invoice_installment
  ON xero_payments(xero_invoice_id, installment_number)
  WHERE installment_number IS NOT NULL;
```

**Row Level Security:**
```sql
-- payment_plan_summary view restricted to service_role only
GRANT SELECT ON payment_plan_summary TO service_role;

-- Admin endpoints use createAdminClient() to query the view
-- No direct user access to raw xero_payments for payment plans
-- User-facing APIs filter and format data through service layer
```

**Email Notifications:**
- **Pre-notification:** Sent 3 days before scheduled payment
- **Payment Processed:** Sent after successful installment payment
- **Payment Failed:** Sent when automatic payment fails (with retry information)
- **Plan Completed:** Sent when final payment completes

**Account Deletion Protection:**
```typescript
// Users cannot delete account with outstanding payment plan balance
const activePaymentPlans = await getActivePaymentPlans(userId)
const totalOutstanding = calculateOutstandingBalance(activePaymentPlans)

if (totalOutstanding > 0) {
  throw new Error('Cannot delete account with outstanding payment plan balance')
}
```

**Alternative Considered (Architecture):**
1. Separate `payment_plans` and `payment_plan_transactions` tables (original implementation)
2. External payment plan service (Stripe Billing)

**Trade-off:** Lost separate tracking tables, gained unified payment architecture and simpler data model

**When to Use Payment Plans:**
- ✅ High-value registrations where affordability is a barrier
- ✅ User has established relationship (saved payment method)
- ✅ Admin has approved user for payment plan eligibility
- ✅ Organization wants to offer flexible payment options

### Migration History

**2025-11-06:** Payment Plans Refactor (`2025-11-06-refactor-payment-plans-to-xero-payments.sql`)
- **Architecture Change:** Consolidated payment plans into `xero_payments` table
- Dropped `UNIQUE(xero_invoice_id, tenant_id)` constraint to allow multiple payments per invoice
- Added `payment_type`, `installment_number`, `planned_payment_date` columns to `xero_payments`
- Extended `sync_status` enum with 'staged', 'planned', 'cancelled' states
- Created `payment_plan_summary` view for aggregated payment plan queries
- Dropped legacy `payment_plans` and `payment_plan_transactions` tables
- Improved: Single source of truth for all payments, better Xero integration

**2025-11-03:** Initial Payment Plans System (superseded by 2025-11-06 refactor)
- Added `payment_plan_enabled` flag to users table (retained in refactor)
- Created separate `payment_plans` and `payment_plan_transactions` tables (now dropped)
- Initial implementation later refactored for better integration

## Future Considerations

### Scalability
Current design supports:
- Thousands of users
- Hundreds of registrations per season
- High payment volume with proper indexing

### Extensibility
Easy to add:
- New item types to payment system
- Additional membership tiers
- Complex pricing structures
- Discount and promotion systems

## Migration Strategy

Database changes are managed through:
- Sequential migration files in `supabase/` directory
- Schema.sql as source of truth for new deployments
- Careful constraint additions to avoid breaking existing data

### Recent Migration History

**2025-07-09:** Member ID System (`2025-07-09-add-member-id-system.sql`)
- Added `member_id` column to users table with auto-generated sequential IDs
- Created sequence starting from 1000 for professional appearance
- Added trigger for automatic member ID assignment on user creation
- Enables unique Xero contact identification with clean "Name - ID" format

**2025-07-08:** Xero Integration Schema (`2025-07-08-add-xero-integration-schema.sql`)
- Added `xero_oauth_tokens` table for secure OAuth token management
- Added `xero_contacts` table for contact synchronization tracking
- Added `xero_invoices` table for invoice synchronization with payment linking
- Added `xero_payments` table for payment recording and fee tracking
- Added `xero_sync_logs` table for comprehensive audit trail
- Added `xero_invoice_line_items` table for detailed invoice component tracking

**2025-07-08:** System Accounting Codes (`2025-07-08-add-system-accounting-codes.sql`)
- Added `system_accounting_codes` table for Xero chart of accounts mapping
- Enables flexible assignment of accounting codes to different transaction types

**2025-07-03:** Discount Categories System (`2025-07-03-add-discount-categories-system.sql`)
- Added `discount_categories` table for organizational grouping of discount codes
- Added `discount_codes` table for individual discount code management
- Added `discount_usage` table for tracking usage against category limits
- Enables sophisticated discount management with per-category limits and accounting integration

**2025-07-02:** Processing Status and Reservation System (`2025-07-02-add-processing-status-and-reservation-system.sql`)
- Added `processing_expires_at` to `user_registrations` for temporary spot reservations
- Enhanced payment processing with atomic spot reservation capabilities
- Prevents race conditions during high-demand registration periods

## Xero Integration Architecture

### 7. Accounting System Integration Pattern

**Pattern Used:** Bi-directional sync tracking with audit trails

```sql
-- Core sync tracking
xero_invoices (
  payment_id: UUID              -- Links to payments table
  tenant_id: TEXT               -- Xero organization ID
  xero_invoice_id: UUID         -- Xero's invoice ID
  sync_status: ENUM             -- 'pending' | 'synced' | 'failed'
  last_synced_at: TIMESTAMP
)

-- Detailed audit logging
xero_sync_logs (
  operation_type: ENUM          -- 'contact_sync' | 'invoice_sync' | 'payment_sync'
  status: ENUM                  -- 'success' | 'error' | 'warning'
  error_message: TEXT
  request_data: JSONB           -- Full API payloads for debugging
  response_data: JSONB
)
```

### Contact Management & Conflict Resolution

**Xero API Constraints:**
- ✅ **Contact Names Must Be Unique**: Xero enforces unique contact names globally
- ⚠️ **Email Addresses Can Be Duplicated**: Multiple contacts can share the same email
- 🔒 **Archived Contacts Cannot Be Updated**: Archived contacts require special handling

**Our Resolution Strategy:**

1. **Member ID Integration**: All users get unique member_id (1001, 1002, etc.)
   ```sql
   -- User table includes member_id for contact naming
   users (
     member_id: INTEGER UNIQUE  -- Auto-incrementing member number
   )
   ```

2. **Contact Naming Convention**: 
   - **Primary Format**: "First Last - MemberID" → "David Wender - 1001"
   - **Conflict Resolution**: "First Last - MemberID (timestamp)" → "David Wender - 1001 (43423)"

3. **Archived Contact Handling**:
   - **Detection**: API returns validation error for archived contacts
   - **Strategy**: Create new contact instead of unarchiving (respects business decisions)
   - **Naming**: Uses member ID + timestamp for uniqueness

**Benefits:**
- **Guaranteed Uniqueness**: Member ID prevents naming conflicts
- **Business Logic Respect**: Doesn't override archival decisions
- **Audit Trail**: Clear tracking when multiple contacts needed
- **Easy Identification**: Member number always visible in Xero

**Why This Pattern:**
- **Reliability:** Complete audit trail for debugging sync issues
- **Resilience:** Failed syncs don't break payment processing
- **Transparency:** Clear visibility into integration status
- **Multi-tenant:** Supports multiple Xero organizations
- **Reconciliation:** Detailed tracking enables financial reconciliation

**Key Design Decisions:**

1. **Payment Processing Independence:** Xero sync failures don't prevent payment completion
2. **Automatic Sync:** New payments trigger immediate sync attempts via webhooks
3. **Manual Recovery:** Admin interface for bulk sync and retry operations
4. **Fee Tracking:** Stripe processing fees tracked separately for expense recording
5. **Discount Integration:** Discount codes appear as negative line items in invoices

### 8. OAuth Token Management

**Pattern Used:** Secure token storage with automatic refresh

```sql
xero_oauth_tokens (
  tenant_id: TEXT UNIQUE        -- Xero organization identifier
  access_token: TEXT            -- Encrypted OAuth access token
  refresh_token: TEXT           -- Encrypted OAuth refresh token
  expires_at: TIMESTAMP         -- Token expiration tracking
  is_active: BOOLEAN            -- Connection status
)
```

**Security Considerations:**
- Tokens stored in secure database with RLS policies
- Automatic token refresh before expiration
- Admin-only access to integration management
- Audit logging for all OAuth operations

### 9. Financial Data Consistency

**Invoice Line Item Tracking:**
```sql
xero_invoice_line_items (
  line_item_type: ENUM          -- 'membership' | 'registration' | 'discount' | 'donation'
  item_id: UUID                 -- References source record
  unit_amount: INTEGER          -- Amount in cents (can be negative for discounts)
  account_code: TEXT            -- Xero chart of accounts mapping
)
```

**Benefits:**
- **Detailed Reconciliation:** Line-by-line tracking of invoice components
- **Account Mapping:** Flexible assignment to Xero chart of accounts
- **Discount Transparency:** Clear breakdown of promotional pricing
- **Audit Compliance:** Complete financial paper trail

### Integration Workflow

1. **Payment Completed** → Stripe webhook triggers auto-sync
2. **Contact Sync** → Create/update customer in Xero
3. **Invoice Creation** → Generate detailed invoice with line items
4. **Payment Recording** → Record net payment (gross - Stripe fees)
5. **Fee Tracking** → Optional expense recording for processing fees
6. **Error Handling** → Failed syncs logged with retry capability

**Performance Optimizations:**
- Efficient indexing on sync status and tenant IDs
- Rate limiting to respect Xero API limits
- Bulk operations for historical data migration
- Real-time sync status in admin interface

---

*This document should be updated when significant architectural decisions are made or patterns are changed.*