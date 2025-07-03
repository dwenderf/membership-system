# Database Architecture & Design Decisions

## Overview
This document explains the database design patterns, architectural decisions, and trade-offs made in the Hockey Association Membership System.

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

### Query Patterns
Database schema optimized for common queries:
- User's active memberships (validity date range checks)
- Registration eligibility (membership requirement checks)
- Payment reconciliation (Stripe ID lookups)
- Account deletion filtering (`WHERE deleted_at IS NULL`)
- Orphaned user record identification (`WHERE deleted_at IS NOT NULL`)

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

---

*This document should be updated when significant architectural decisions are made or patterns are changed.*