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

## Security Model

### Row Level Security (RLS)
All tables use RLS with policies ensuring:
- Users can only access their own data
- Admins can access all data
- Public read access for reference data (seasons, memberships, registrations)

### Payment Security
- Payment operations require authentication
- Stripe handles sensitive payment data (PCI compliance)
- Local database stores only metadata and status

## Performance Considerations

### Indexes
- Membership validity queries: `idx_user_memberships_validity`
- Membership type queries: `idx_user_memberships_membership_type`
- Payment lookups by Stripe ID for webhook processing

### Query Patterns
Database schema optimized for common queries:
- User's active memberships (validity date range checks)
- Registration eligibility (membership requirement checks)
- Payment reconciliation (Stripe ID lookups)

## Data Integrity

### Constraints
- Date validations: `valid_until > valid_from`
- Payment status enums: `'pending' | 'paid' | 'refunded'`
- Pricing logic: `price_annual <= price_monthly * 12`

### Business Logic
- Smart membership extension (application-level)
- Category-level membership requirements
- Capacity management with overflow to waitlists

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