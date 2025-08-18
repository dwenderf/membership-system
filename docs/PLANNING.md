# Hockey Association Membership System - Planning Document

## Project Overview
A comprehensive membership and registration system for an adult hockey association that runs its own league and individual teams.

## Project Status 🚀

### Recent Achievements (2025-07-11)
- ✅ **Phase 8: Xero Accounting Integration** - **COMPLETED**
  - Full OAuth 2.0 implementation with automatic token management
  - Intelligent contact management with 80%+ duplicate reduction
  - Real-time invoice and payment synchronization
  - Advanced error handling and monitoring with Sentry integration
  - Production-ready with comprehensive documentation

- ✅ **Critical Payment System Fixes** - **COMPLETED**
  - Fixed race condition where wrong payment records were updated during retry attempts
  - Resolved frontend caching causing stale payment intent IDs in PaymentForm component
  - Implemented proper payment lifecycle tracking with audit trails
  - Added completed_at timestamps for final payment states
  - Fixed email confirmation errors with Loops.so API integration
  - Enhanced payment status updates with centralized API endpoint

- ✅ **Xero Token Keep-Alive System** - **COMPLETED**
  - Automated token refresh system to prevent Xero authentication failures
  - Vercel Cron job running every 12 hours for production environments
  - Startup connection testing for development and deployment scenarios
  - Comprehensive documentation and monitoring with error logging
  - Supports both scheduled (production) and startup-based (development) token management

### Current Status
The core membership and registration system is **production-ready** with all critical features completed:
- Complete payment processing with retry reliability
- Xero accounting integration with automated token management  
- Comprehensive waitlist and discount systems
- Full admin and user interfaces

**Optional Future Enhancements**: Admin reporting dashboard, content management system, enhanced email marketing tools

### System Maturity
- **Core Features**: ✅ Production Ready (Memberships, Registrations, Payments)
- **Advanced Discounts**: ✅ Production Ready (PRIDE codes, Category limits, Season caps)
- **Accounting Integration**: ✅ Production Ready (Xero full integration)
- **Admin Tools**: 🚧 In Development (Waitlist management, Advanced reporting)

## Core Requirements

### User Types
- **Members**: Basic access with flexible tags (player, referee, etc.)
- **Admins**: Full system access and management capabilities

### Key Features
- Seasonal membership system (Fall/Winter, Spring/Summer)
- Team and event registration with capacity management
- Flexible pricing with tiered rates and discount codes
- Modular payment processing (Stripe first, extensible)
- Waitlist management with admin bypass codes
- Email communication system
- Accounting system integration

## User Stories

### Member Stories
- As a member, I want to register for a team so I can play hockey
- As a member, I want to see if I need to buy a membership when registering
- As a member, I want to join a waitlist when registration is full
- As a member, I want to use special codes for early registration or discounts
- As a member, I want to register for multiple teams in the same season

### Admin Stories
- As an admin, I want to create registrations with caps and pricing tiers
- As an admin, I want to view waitlists and generate bypass codes
- As an admin, I want to assign membership requirements to registrations
- As an admin, I want to manually process refunds
- As an admin, I want to track email communications and user engagement
- As an admin, I want to generate reports on discount code usage

## Tech Stack

### Database
- **Supabase** (PostgreSQL with real-time features, built-in auth, RLS)

### Payments
- **Stripe** (primary payment processor)
- Modular architecture for future payment methods

### Email
- **Loops.so** for email campaigns and automation

### Authentication
- **Passwordless system** (magic links, Google, Apple login)
- Login attempt tracking for security

## Data Models

### Core User Management
```sql
users (
  id: uuid PRIMARY KEY
  email: text UNIQUE NOT NULL
  first_name: text NOT NULL
  last_name: text NOT NULL
  phone: text
  is_admin: boolean DEFAULT false
  tags: text[] -- ['player', 'referee', etc.]
  created_at: timestamp
  updated_at: timestamp
)

login_attempts (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id) -- NULL if user doesn't exist
  email: text NOT NULL
  method: text NOT NULL -- "magic_link" | "google" | "apple"
  ip_address: inet NOT NULL
  user_agent: text
  success: boolean NOT NULL
  failure_reason: text
  attempted_at: timestamp NOT NULL DEFAULT now()
)

magic_link_tokens (
  id: uuid PRIMARY KEY
  email: text NOT NULL
  token: text UNIQUE NOT NULL
  expires_at: timestamp NOT NULL
  used_at: timestamp -- NULL until used
  ip_address: inet NOT NULL
  created_at: timestamp NOT NULL DEFAULT now()
)
```

### Season and Membership Management
```sql
seasons (
  id: uuid PRIMARY KEY
  name: text NOT NULL -- "Fall/Winter 2025"
  type: text NOT NULL -- "fall_winter" | "spring_summer"
  start_date: date NOT NULL -- Sept 1 for Fall/Winter, March 1 for Spring/Summer
  end_date: date NOT NULL
  is_active: boolean DEFAULT true
  created_at: timestamp
)

memberships (
  id: uuid PRIMARY KEY
  name: text NOT NULL -- "Full Hockey Membership", "Social Membership"
  description: text -- "Includes ice time, tournaments, and events"
  price_monthly: integer NOT NULL -- in cents
  price_annual: integer NOT NULL -- in cents  
  accounting_code: text
  allow_discounts: boolean DEFAULT true
  created_at: timestamp
  
  CONSTRAINT chk_annual_pricing CHECK (price_annual <= price_monthly * 12)
)

user_memberships (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  membership_id: uuid REFERENCES memberships(id)
  valid_from: date NOT NULL
  valid_until: date NOT NULL
  months_purchased: integer
  payment_status: text NOT NULL -- "pending" | "paid" | "refunded"
  stripe_payment_intent_id: text
  amount_paid: integer -- in cents
  purchased_at: timestamp
  created_at: timestamp
  
  CONSTRAINT chk_membership_validity CHECK (valid_until > valid_from)
)
```

### Registration System
```sql
registrations (
  id: uuid PRIMARY KEY
  season_id: uuid REFERENCES seasons(id)
  name: text NOT NULL -- "Rec League Team A", "Friday Scrimmage"
  type: text NOT NULL -- "team" | "scrimmage" | "event"
  allow_discounts: boolean DEFAULT true
  created_at: timestamp
)

registration_categories (
  id: uuid PRIMARY KEY
  registration_id: uuid REFERENCES registrations(id)
  category_id: uuid REFERENCES categories(id) -- NULL for custom categories
  custom_name: text -- NULL for standard categories
  max_capacity: integer -- NULL for unlimited
  accounting_code: text
  required_membership_id: uuid REFERENCES memberships(id) -- Category-level membership requirement
  sort_order: integer DEFAULT 0
  created_at: timestamp
)

user_registrations (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  registration_id: uuid REFERENCES registrations(id)
  user_membership_id: uuid REFERENCES user_memberships(id) -- NULL for free events
  payment_status: text NOT NULL -- "pending" | "paid" | "refunded"
  registration_fee: integer -- in cents
  amount_paid: integer -- in cents (after discounts)
  registered_at: timestamp
  created_at: timestamp
  
  UNIQUE(user_id, registration_id)
)
```

### Pricing and Discounts
```sql
registration_pricing_tiers (
  id: uuid PRIMARY KEY
  registration_id: uuid REFERENCES registrations(id)
  tier_name: text NOT NULL -- "pre_sale" | "early" | "normal" | "late"
  price: integer NOT NULL -- in cents
  starts_at: timestamp NOT NULL
  requires_code: boolean DEFAULT false -- true for pre-sale
  created_at: timestamp
  
  UNIQUE(registration_id, tier_name)
)

-- NEW: Category-based discount system for organizational management
discount_categories (
  id: uuid PRIMARY KEY
  name: text NOT NULL -- "Scholarship Fund", "Board Member", "Captain", "Volunteer"
  accounting_code: text NOT NULL -- For Xero integration ("DISCOUNT-SCHOLAR", "DISCOUNT-BOARD")
  max_discount_per_user_per_season: integer -- In cents, NULL = no limit (e.g., $500 = 50000)
  is_active: boolean DEFAULT true
  description: text -- Optional description
  created_at: timestamp
)

-- UPDATED: Discount codes now belong to categories
discount_codes (
  id: uuid PRIMARY KEY
  discount_category_id: uuid REFERENCES discount_categories(id)
  code: text UNIQUE NOT NULL -- "PRIDE100", "PRIDE75", "PRIDE50", "PRIDE25"
  percentage: decimal(5,2) NOT NULL -- 100.00, 75.00, 50.00, 25.00
  is_active: boolean DEFAULT true
  valid_from: timestamp
  valid_until: timestamp
  created_at: timestamp
)

-- UPDATED: Track usage per category for limit enforcement
discount_usage (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  discount_code_id: uuid REFERENCES discount_codes(id)
  discount_category_id: uuid REFERENCES discount_categories(id) -- Denormalized for fast queries
  season_id: uuid REFERENCES seasons(id)
  amount_saved: integer NOT NULL -- in cents
  used_at: timestamp NOT NULL
  registration_id: uuid REFERENCES registrations(id) -- What they used it on
)
```

### Access Codes and Waitlists
```sql
access_codes (
  id: uuid PRIMARY KEY
  code: text UNIQUE NOT NULL
  type: text NOT NULL -- "pre_sale" | "waitlist_bypass"
  registration_id: uuid REFERENCES registrations(id) -- NULL for pre-sale codes
  generated_by: uuid REFERENCES users(id) -- admin who created it
  is_single_use: boolean NOT NULL -- false for pre-sale, true for waitlist
  expires_at: timestamp
  is_active: boolean DEFAULT true
  created_at: timestamp
)

access_code_usage (
  id: uuid PRIMARY KEY
  access_code_id: uuid REFERENCES access_codes(id)
  user_id: uuid REFERENCES users(id)
  registration_id: uuid REFERENCES registrations(id)
  used_at: timestamp NOT NULL DEFAULT now()
  
  UNIQUE(access_code_id, user_id, registration_id)
)

waitlists (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  registration_id: uuid REFERENCES registrations(id)
  position: integer NOT NULL
  joined_at: timestamp NOT NULL DEFAULT now()
  bypass_code_generated: boolean DEFAULT false
  bypass_code_id: uuid REFERENCES access_codes(id)
  removed_at: timestamp -- NULL while active
  
  UNIQUE(user_id, registration_id)
)
```

### Payment System
```sql
payments (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  total_amount: integer NOT NULL -- in cents
  discount_amount: integer DEFAULT 0 -- in cents
  final_amount: integer NOT NULL -- in cents
  stripe_payment_intent_id: text
  status: text NOT NULL -- "pending" | "completed" | "failed" | "refunded"
  payment_method: text -- "stripe" | future payment methods
  refund_reason: text
  refunded_by: uuid REFERENCES users(id) -- admin who processed refund
  created_at: timestamp
  completed_at: timestamp
)

payment_items (
  id: uuid PRIMARY KEY
  payment_id: uuid REFERENCES payments(id)  
  item_type: text NOT NULL -- "membership" | "registration"
  item_id: uuid NOT NULL -- references memberships or registrations
  amount: integer NOT NULL -- in cents
  created_at: timestamp
)

payment_configurations (
  id: uuid PRIMARY KEY
  provider: text NOT NULL -- "stripe" | "paypal" | "square"
  is_active: boolean DEFAULT false
  is_primary: boolean DEFAULT false
  configuration: jsonb NOT NULL -- provider-specific settings
  created_at: timestamp
)
```

### Email System
```sql
email_logs (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  email_address: text NOT NULL
  event_type: text NOT NULL -- "membership.purchased", "registration.completed", etc.
  subject: text NOT NULL
  template_id: text -- Loops template ID
  loops_event_id: text -- Loops tracking ID
  
  status: text NOT NULL DEFAULT 'sent' -- "sent" | "delivered" | "bounced" | "spam"
  sent_at: timestamp NOT NULL DEFAULT now()
  delivered_at: timestamp
  opened_at: timestamp
  first_clicked_at: timestamp
  bounced_at: timestamp
  bounce_reason: text
  
  email_data: jsonb -- data sent to template
  triggered_by: text -- "user_action" | "admin_send" | "automated"
  triggered_by_user_id: uuid REFERENCES users(id)
  
  created_at: timestamp
)
```

## Business Logic

### Season Management
- **Fiscal year**: Starts September 1st
- **Fall/Winter Season**: Sept 1 - Feb 28/29
- **Spring/Summer Season**: March 1 - Aug 31
- **Flexible architecture**: Easy to modify season structure in future

### Membership & Registration Flow
1. User attempts to register for team/event category
2. System checks if category requires specific membership type
3. If membership required: check if user has valid membership covering season dates
4. If no valid membership: redirect to purchase membership (monthly/annual options)
5. If has valid membership: proceed with registration only
6. Apply current pricing tier based on date
7. Apply discount codes if provided
8. Process payment through configured provider
9. Send confirmation emails

### Membership Model
- **Flexible Duration**: Users purchase memberships for custom time periods
- **Membership Types**: Different levels (Full Hockey, Social, Youth, etc.)
- **Pricing Options**: Monthly rate or discounted annual rate
- **Validity Periods**: Memberships cover specific date ranges, not seasons
- **Multi-Season Coverage**: Annual memberships can cover multiple seasons automatically

### Pricing Tiers Logic
- **Current price = most recent tier** where `starts_at <= NOW()`
- **No end times** to prevent gaps/overlaps
- **Pre-sale tiers** require access codes
- **Example**: Pre-sale (Sept 1) → Early (Sept 15) → Normal (Oct 1) → Late (Nov 1)

### Discount System
- **Multi-use codes** (unlimited usage)
- **Per-user, per-season caps** (resets each season)
- **Percentage-based** with maximum amounts
- **Usage tracking** for admin reports
- **Accounting codes** for financial integration

### Waitlist Management
- **Admin-only visibility** of waitlists
- **Automatic waitlist join** when registration full
- **Admin generates bypass codes** for waitlisted users
- **Single-use bypass codes** remove user from waitlist
- **Position tracking** in queue

## Key Integrations

### Stripe Payment Processing
- Payment intents for secure processing
- Webhook handling for status updates
- Refund management through admin interface
- Metadata tracking for accounting

### Loops.so Email Automation
- Event-triggered emails (registration, payments, etc.)
- Contact property synchronization
- Template management
- Delivery and engagement tracking

### Accounting System Integration
- Accounting codes on registrations and discount codes
- Payment export capabilities
- Revenue reporting by category

### Enhanced Refund System 🚧
**Status**: UI Foundation Complete, API Implementation Pending

The refund system addresses two primary use cases for admin-initiated refunds:
1. **Standard Refunds**: Injuries, accidental purchases, cancellations
2. **Retroactive Discount Application**: User forgot to apply discount code at purchase

#### Completed Features ✅
- **Staging-First Architecture**: Credit notes use database staging before Xero sync
- **Proportional Line Item Allocation**: Maintains accounting structure (positive charges + negative discounts)
- **Enhanced Admin UI**: Comprehensive refund history with credit note line items
- **Xero Integration**: Full credit note sync with payment allocation
- **Two-Type RefundModal**: Radio selection between proportional and discount code refunds
- **Working Discount Validation**: Real-time discount code validation using existing API endpoint with proper debouncing
- **Form Stability**: Moved validation messages to main error area to prevent form jumping
- **API Integration**: Created `/api/admin/payments/[paymentId]/registrations` endpoint for season context

#### Architecture Benefits
- **Exact ID Mapping**: Eliminates webhook search-and-match edge cases
- **Immediate Staging**: Credit notes staged when admin submits, not when webhook arrives
- **Proper Accounting**: Credit notes preserve original invoice structure
- **Season Usage Tracking**: Discount validation respects per-season usage limits

#### Remaining Implementation 🚧
- **Enhanced Staging Methods**: Discount-based credit notes with single line items vs proportional allocation
- **Webhook Simplification**: Direct xero_invoice_id lookup instead of payment_id searching
- **Preview Functionality**: Show exact line items and amounts before submission
- **Refund API Enhancement**: Update to support both refund types with immediate staging

#### Technical Architecture
```typescript
// Two refund pathways:
type RefundType = 'proportional' | 'discount_code'

// Proportional: Current behavior
- Calculate proportional line items based on original invoice
- Maintain positive/negative amounts (charges/discounts)
- Create multiple line items matching original structure

// Discount Code: New behavior  
- Validate discount code with season usage limits
- Create single line item for discount amount
- Use discount's accounting code and category
- Handle partial discounts when hitting usage caps
```

## Security Considerations

### Authentication
- Passwordless system reduces attack surface
- OAuth integration with Google/Apple
- Magic link token expiration and single-use
- Login attempt tracking and rate limiting

### Data Protection
- Supabase Row Level Security (RLS)
- Admin role-based access control
- Payment data encrypted via Stripe
- Audit trails for sensitive operations

### Compliance
- Email delivery tracking for compliance
- Payment history preservation
- User consent management
- Data retention policies

## Future Enhancements (Phase 2)

### Content Management System
- **Dynamic Legal Documents Management**
  - Admin interface for editing Privacy Policy, Terms of Service, Code of Conduct
  - Rich text editor with version history
  - Template system for consistent formatting
  - Legal compliance tracking and archival
  - Multi-language support for documents
  - Document approval workflow for sensitive changes

### Organization Configuration Management
- **Advanced Organization Settings**
  - Admin interface for organization name, contact info, branding
  - Logo upload and management system
  - Color scheme customization
  - Feature flag management through admin UI
  - Deployment-specific configuration management

### Hockey-Specific Features
- Game scheduling and results tracking
- Player statistics and performance metrics
- Team standings and league tables
- Equipment and waiver management

### Advanced Features
- Mobile app development
- Advanced reporting and analytics
- Multi-language support
- API for third-party integrations

## Implementation Priorities

### Phase 1 (MVP)
1. User management and authentication
2. Season and membership setup
3. Basic registration system
4. Stripe payment integration
5. Email notification system

### Phase 2 (Enhanced Features)
1. Pricing tiers and discount codes
2. Waitlist management system
3. Admin dashboard and reporting
4. Advanced email automation

### Phase 3 (Hockey Features)
1. Game and schedule management
2. Statistics tracking
3. Mobile application
4. Advanced analytics

## Implementation Status

### ✅ Core System Foundation
**Authentication & User Management**
- [x] Next.js project setup with TypeScript and Tailwind CSS
- [x] Supabase integration with Row Level Security (RLS) policies
- [x] Authentication system (magic links + Google OAuth)
- [x] User management with admin roles and protected routes
- [x] User dashboard with responsive design and role switching
- [x] Account management and profile editing

**Season & Membership Management**
- [x] Smart season creation with auto-generated names and dates
- [x] Duration-based membership model with monthly/annual pricing
- [x] Membership validity tracking across seasons
- [x] Real-time form validation and duplicate prevention

**Registration System**
- [x] Hybrid category management (standard + custom categories)
- [x] Category-level membership requirements and capacity limits
- [x] Registration timing controls (draft, presale, open, expired)
- [x] Enhanced admin workflow with visual capacity management

**Database Architecture**
- [x] Complete schema with all planned features
- [x] Migration system for seamless updates
- [x] Performance indexes and integrity constraints
- [x] Utility functions for consistent data access

### ✅ Payment & Purchase Systems
**Membership Purchase Flow**
- [x] Complete purchase workflow with duration selection
- [x] Stripe payment integration with Elements UI and webhook processing
- [x] Smart date extension logic for existing memberships
- [x] Three-option payment system (standard, financial assistance, donations)
- [x] Purchase history and consolidated membership display

**Registration Purchase Flow**
- [x] Category selection with dynamic pricing
- [x] Membership requirement validation
- [x] 5-minute reservation system preventing race conditions
- [x] Payment countdown timer with automatic cleanup
- [x] Presale code functionality with audit tracking

**Email & Notifications**
- [x] Loops.so integration for transactional emails
- [x] Purchase confirmations and registration notifications
- [x] Toast notification system throughout purchase flows
- [x] Waitlist confirmation emails with position tracking

### ✅ Advanced Features & Integrations
**Waitlist System**
- [x] Category-specific waitlist with position tracking
- [x] Automatic waitlist join when capacity reached
- [x] Waitlist confirmation emails with position details
- [x] Real-time state management preventing duplicate joins

**Discount Code System**
- [x] Category-based discount codes with accounting integration
- [x] Season spending limits per user per category
- [x] Smart partial discount application
- [x] Admin interface for category and code management
- [x] Real-time validation in checkout flow

**User Experience & Privacy**
- [x] Complete onboarding flow with legal compliance
- [x] Account deletion with authentication prevention
- [x] Business data preservation for auditing
- [x] Error monitoring with Sentry integration

**Xero Accounting Integration**
- [x] OAuth 2.0 setup with automatic token management
- [x] Automated invoice creation for all purchases
- [x] Intelligent contact management with duplicate resolution
- [x] Stripe fee tracking and payment reconciliation
- [x] Token keep-alive system for production reliability

### 🚀 **FUTURE ENHANCEMENTS**
- [ ] Renewal notifications and automated renewal flow
- [ ] Upgrade/downgrade between membership types
- [ ] Advanced analytics and reporting dashboard
- [ ] Mobile application development
- [ ] Multi-language support

## Architectural Principles

### Database Access Pattern (API-First Architecture)
**Preferred Pattern:** All database operations should go through Next.js API routes rather than direct client-side queries.

**Why API-First:**
- **Enhanced Security:** Server-side validation and authorization before database access
- **Centralized Business Logic:** Complex operations handled in controlled server environment
- **Better Error Handling:** Consistent error responses and logging
- **Easier Testing:** Business logic in testable API endpoints
- **Future Flexibility:** API layer can evolve without breaking client implementations
- **Performance Control:** Server can optimize queries and implement caching

**When to Use API Routes:**
- ✅ Complex business logic operations
- ✅ Multi-table transactions  
- ✅ Admin operations requiring authorization
- ✅ Payment processing and financial operations
- ✅ Data validation and transformation

**When Direct Client Queries Are Acceptable:**
- Simple, read-only operations for public data
- Real-time subscriptions for UI updates
- Basic user profile updates

### ⚠️ Security Items to Address
- [x] **COMPLETED**: Fix user_memberships RLS policies to allow user INSERT/UPDATE operations
- [x] **COMPLETED**: Fix admin RLS policies to only allow actual admins (migration created: 20250702000000_fix_admin_rls_policies.sql)

---

*Last updated: July 11, 2025*
*Status: **Production-Ready Core System** - Complete membership/registration system with Xero integration, payment reliability fixes, and automated token management*

### Historic Development Summary

**Previous Major Phases Completed:**
- ✅ **Three-Option Membership Payment System**: Financial assistance, donation support, standard payment with accounting separation
- ✅ **Smart Partial Discount System**: Category-based discounts with intelligent season limit handling
- ✅ **Complete Reservation System**: 5-minute payment timer with race condition protection
- ✅ **Comprehensive Waitlist System**: Category-specific waitlists with position tracking and email notifications
- ✅ **Enhanced Membership Validation**: Season-long coverage validation with user-friendly warnings
- ✅ **Advanced Registration Management**: Complete timing controls, presale codes, and admin workflow

## 🔮 Future Technical Improvements

### Database Naming Consistency (Deferred)

**Issue Identified**: Inconsistent naming patterns for master/instance table relationships
- `categories` (master) → `registration_categories` (instances)  
- `discount_categories` (master) → `discount_codes` (instances)

**Proposed Solution**: Consistent naming pattern for architectural clarity
- `registration_categories` (master) → `registration_category_instances` (instances)
- `discount_categories` (master) → `discount_category_instances` (instances)

**Benefits**:
- Clear master/instance relationship pattern
- More self-documenting schema
- Easier onboarding for new developers
- Consistent architectural patterns

**Complexity Considerations**:
- Extensive code changes across API endpoints, frontend components, and database queries
- Complex multi-table renaming requires careful sequencing to avoid naming conflicts
- High risk operation requiring comprehensive testing
- Would need temporary table names during migration to avoid conflicts

**Decision**: Deferred due to high complexity/risk ratio. Current naming works well and this is primarily an architectural aesthetic improvement rather than functional necessity.

**Future Implementation Strategy** (if pursued):
1. Create intermediate migration with temporary table names
2. Update all code references systematically
3. Final migration to desired names
4. Comprehensive testing of all functionality
5. Consider implementing during major version upgrade when other breaking changes are planned

## Future Enhancements

🔮 **Membership Purchase Limits**
- **Purchase Time Limits**: Add validation to limit membership purchases to 12-18 months in advance to prevent excessive advance purchases
- **Business Protection**: Prevent users from purchasing unreasonable durations that could impact system sustainability

### 🚀 **Next Priority Recommendations**
1. **Admin Reporting Dashboard** - Payment reconciliation and membership analytics  
2. **Content Management** - Admin interface for Terms & Conditions updates
3. **User Management System** - Complete admin interface for managing user accounts and roles
4. **Email Marketing** - Send team/event emails through admin interface

## 📋 Pending Technical Improvements

### Console Log Migration Progress
**Issue**: Mixed console.log statements and structured logging throughout the codebase causing inconsistent log output and reduced observability.

**Current Status**: 
- ✅ **Option A (Main Offenders) - COMPLETED**: Core system files and critical APIs migrated to structured logging
  - ✅ xero-client.ts, startup.ts
  - ✅ /api/create-membership-payment-intent/route.ts - Fixed free membership payment completion and migrated all logging
  - ✅ /api/create-registration-payment-intent/route.ts - Migrated payment processing and Stripe integration logging
  - ✅ xero-staging.ts - Migrated all staging record creation and management logging
  - ✅ All major terminal output clutter eliminated from startup and operation logs
- ⚠️ **Option B (Comprehensive Migration)**: 60+ remaining files still contain console.log statements throughout debug scripts, admin tools, and minor components

**Remaining Scope of Work (Option B)**:
1. **Debug Scripts** (5+ files): Convert debugging tools and admin utilities to structured logging
2. **API Routes** (20+ files): Convert remaining console.log/error statements to structured logger calls
3. **Service Layer** (10+ files): Migrate remaining business logic logging to centralized system  
4. **Component Layer** (15+ files): Replace debug console.log with appropriate logging levels
5. **Utility Functions** (10+ files): Standardize error and debug logging patterns

**Current Terminal Output**: Clean startup and operation with all major noise eliminated. Remaining console.log statements are primarily in debug scripts and less frequently used components.

**Benefits**:
- **Consistent Log Output**: All logs appear in admin log viewer with proper categorization
- **Better Observability**: Structured metadata makes debugging and monitoring more effective
- **Production Ready**: File-based logs in local environments, cloud logging in production
- **Centralized Control**: Single configuration point for log levels and output formats

**Implementation Strategy**:
1. Create automated script to identify all console.log usage patterns
2. Replace with appropriate logger category calls (payment-processing, xero-sync, etc.)
3. Add proper error context and metadata to each log statement
4. Update any remaining services to import and use centralized logger
5. Add log level configuration for different environments

**Estimated Effort**: 1-2 development sessions for comprehensive migration
**Priority**: Medium (improves observability but doesn't affect core functionality)

### Real-time Payment Processing (Option A Upgrade)
**Issue**: Payment completion processor uses realtime subscriptions that aren't triggering properly in current environment.

**Current Status**: 
- ✅ Scheduled processing working (2-minute delay)
- ❌ Real-time processing (immediate) not functioning
- ✅ Fallback batch processor handles everything correctly

**Scope of Work**:
1. **Debug Supabase Realtime**: Investigate why realtime subscriptions aren't triggering
2. **Connection Management**: Ensure persistent connections work in production environment
3. **Fallback Strategy**: Verify scheduled processing continues when realtime fails
4. **Testing**: Create test cases for both realtime and scheduled flows

**Benefits**:
- **Immediate Processing**: Staging records created instantly vs. 2-minute delay
- **Better UX**: Faster email confirmations and Xero sync initiation
- **Redundancy**: Two processing paths ensure nothing gets missed

**Implementation Strategy**:
1. Investigate Supabase realtime connection issues in development
2. Test realtime subscriptions work correctly in different environments
3. Add connection health monitoring and automatic fallback
4. Create admin interface to view realtime connection status

**Estimated Effort**: 1 development session for troubleshooting and fixes  
**Priority**: Low (scheduled processing provides reliable fallback)
