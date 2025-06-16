# Hockey Association Membership System - Planning Document

## Project Overview
A comprehensive membership and registration system for an adult hockey association that runs its own league and individual teams.

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

discount_codes (
  id: uuid PRIMARY KEY
  code: text UNIQUE NOT NULL -- "STUDENT15", "EARLY10"
  name: text NOT NULL -- "Student Discount"
  percentage: decimal(5,2) NOT NULL -- 15.00 for 15%
  max_discount_per_user_per_season: integer NOT NULL -- in cents
  accounting_code: text
  is_active: boolean DEFAULT true
  valid_from: timestamp
  valid_until: timestamp
  created_at: timestamp
)

discount_usage (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  discount_code_id: uuid REFERENCES discount_codes(id)
  season_id: uuid REFERENCES seasons(id)
  amount_saved: integer NOT NULL -- in cents
  used_at: timestamp NOT NULL
  transaction_id: uuid -- links to payment record
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

### ✅ Completed (Phase 1)
- [x] Next.js project setup with TypeScript and Tailwind CSS
- [x] Supabase integration and database schema creation
- [x] Authentication system (magic links + Google OAuth)
- [x] User management with admin roles
- [x] Row Level Security (RLS) policies
- [x] Protected routes with middleware
- [x] Admin dashboard with stats for active/future seasons
- [x] Database tables for all planned features
- [x] **Season Management System**
  - [x] Smart season creation (type + year input only)
  - [x] Auto-generated season names and dates
  - [x] Duplicate detection and validation
  - [x] Past date prevention
  - [x] Real-time form validation with warnings
  - [x] Clean season listing interface
  - [x] Status indicators (Active/Ended) with proper color coding
  - [x] Sorted by start date (newest first)
  - [x] Streamlined UI (removed unnecessary edit/view buttons)

### ✅ Completed (Phase 1 continued)
- [x] **Membership Management System**
  - [x] Membership creation interface with season selection
  - [x] Auto-generated membership names based on season
  - [x] Price input with cents conversion for accuracy
  - [x] Accounting code integration
  - [x] Discount eligibility settings
  - [x] Real-time duplicate name validation
  - [x] Visual warning system (yellow box + red background)
  - [x] Form validation preventing invalid submissions
  - [x] Clean membership listing with status indicators
  - [x] Season relationship display
  - [x] Consistent UI styling with season management

- [x] **Registration System with Hybrid Category Management**
  - [x] Registration creation with season and membership integration
  - [x] Registration types (team, scrimmage, event)
  - [x] Registration listing with clickable detail links
  - [x] Real-time duplicate name validation
  - [x] **Hybrid Registration Categories System**
    - [x] Master categories table with system and user categories
    - [x] Standard categories (Player, Goalie, Alternate, Guest, etc.)
    - [x] Custom one-off categories for unique situations
    - [x] Radio button selection between standard and custom
    - [x] Dropdown with grouped system/user categories
    - [x] Category creation with individual capacity limits
    - [x] Per-category accounting code support
    - [x] Smart preset suggestions by registration type
    - [x] Bulk category creation ("Add All" presets)
    - [x] Category-specific capacity tracking and progress bars
    - [x] Sort order management for display control
    - [x] Duplicate category prevention across both types
    - [x] **Category-Level Membership Requirements**
      - [x] Moved membership requirements from registration to category level
      - [x] Database migration to update schema and preserve data
      - [x] Category-specific membership selection in admin interface
      - [x] "No membership required" option per category
      - [x] Warning system when no memberships exist for season
  - [x] **Enhanced Admin Workflow**
    - [x] Registration detail pages with category overview
    - [x] Guided workflow: Registration → Categories → Pricing
    - [x] Visual capacity management with status indicators
    - [x] Clean separation of registration vs category concerns
    - [x] Category type indicators (Standard/Custom badges)
    - [x] **Guided Membership Setup Workflow**
      - [x] Season creation redirects to membership setup page
      - [x] Multi-option membership assignment (existing/new/skip)
      - [x] Pre-selected season parameters for new membership creation
      - [x] Warning systems when no memberships exist
      - [x] Loading states on all creation forms to prevent double-clicking
  - [x] **Database Architecture Improvements**
    - [x] Hybrid categories system with master categories table
    - [x] Foreign key OR custom name constraint system
    - [x] Moved capacity management from registrations to categories
    - [x] Moved accounting codes from registrations to categories
    - [x] Created utility functions for category display and management
    - [x] Eliminated redundant current_count column (now calculated)
    - [x] Eliminated redundant fields and data duplication
    - [x] Database migration scripts for seamless schema updates
    - [x] **Membership Requirements Architecture**
      - [x] Moved required_membership_id from registrations to registration_categories
      - [x] Database migration to preserve existing data relationships
      - [x] Category-level membership constraints for granular control

- [x] **Duration-Based Membership Model Refactor (Major Architecture Change)**
  - [x] **New Flexible Membership Types**
    - [x] Converted from season-specific to reusable membership types
    - [x] Added monthly and annual pricing with automatic savings calculation
    - [x] Added optional descriptions for membership benefits
    - [x] Removed season dependency from membership creation
  - [x] **Enhanced Admin Experience**
    - [x] Simplified membership creation with dual pricing structure
    - [x] Updated membership listing to show pricing comparison and savings
    - [x] Removed unnecessary guided membership setup workflow
    - [x] Improved dropdown UX with "Please select" defaults for required fields
  - [x] **Database Schema Modernization**
    - [x] Complete migration script for new membership model
    - [x] Updated schema.sql to reflect current structure
    - [x] Added integrity constraints for pricing validation
    - [x] Added performance indexes for membership validity queries
    - [x] Preserved existing data with sensible migration defaults
  - [x] **Real-World Usage Patterns**
    - [x] Annual memberships can cover multiple seasons automatically
    - [x] Mini-seasons and tournaments covered by existing memberships
    - [x] Flexible duration purchases (users choose months or annual)
    - [x] Categories can require specific membership types or none
  - [x] **Comprehensive Testing & Bug Fixes**
    - [x] Fixed database field references after schema changes
    - [x] Resolved JavaScript errors in preset functionality
    - [x] Tested full workflow: membership creation → season creation → registration → categories
    - [x] Verified mixed capacity limits and membership requirements work correctly

### ✅ Completed (Phase 1 - User Dashboard Foundation)
- [x] **User Dashboard Core**
  - [x] Create authenticated user dashboard layout and navigation with responsive design
  - [x] Account management page (view/edit profile, contact info, preferences)
  - [x] User authentication state management and protected routes
  - [x] Dashboard home page with personalized overview and quick actions
- [x] **Current Membership Status Display**
  - [x] Show user's active memberships with validity dates and pricing details
  - [x] Display membership type details and benefits
  - [x] Warning indicators for expiring memberships
  - [x] "No active membership" state with clear next steps
  - [x] Available memberships for purchase display
- [x] **Registration History & Status**
  - [x] View current active registrations with payment status
  - [x] Display past registration history organized by season
  - [x] Show registration status (paid, pending, waitlisted) with visual indicators
  - [x] Link to registration details and category information
- [x] **Advanced Features**
  - [x] Hybrid admin/user role switching with intuitive toggle interface
  - [x] Smart dashboard routing with security-first defaults (all users start in member view)
  - [x] Mobile-responsive navigation with collapsible menus
  - [x] Membership eligibility checking for registrations
  - [x] Real-time data integration with Supabase backend

### 🚧 In Progress

### 📋 Next Steps (Payment Integration & Registration Purchase Flow)

#### **✅ Phase 2: Private Membership Purchase Flow - COMPLETED** 💳
- [x] **Browse Available Membership Types**
  - [x] Private page showing all membership types (authenticated users only)
  - [x] Clear pricing display with real-time calculations
  - [x] Membership descriptions and benefits
  - [x] Duration selection UI (3, 6, 12 months) with smart pricing
- [x] **Membership Purchase Workflow**
  - [x] Purchase flow integrated within user dashboard
  - [x] Calculate pricing based on selected duration with savings display
  - [x] Preview membership validity period with smart extension logic
  - [x] **Smart Date Extension**: Seamlessly extends existing memberships vs new purchases
  - [x] Visual indicators for extensions (no gaps or overlaps)
  - [x] Integration point ready for Stripe payment processing
- [x] **Membership Management**
  - [x] View purchase history and receipts
  - [x] **Enhanced Features**: Extension logic, test data tools, RLS policy fixes
  - [ ] Renewal notifications and easy renewal flow
  - [ ] Upgrade/downgrade between membership types

#### **Phase 3: Registration Discovery & Purchase** 🏒
- [ ] **Smart Registration Eligibility**
  - [x] Show available registrations based on current memberships - *Basic display completed*
  - [x] Clear messaging: "You need X membership to register" - *Visual indicators completed*
  - [x] Hide/gray out ineligible registrations with explanations - *Basic eligibility checking completed*
- [ ] **Registration Purchase Flow**
  - [ ] Category selection with capacity indicators
  - [ ] Membership + registration bundle recommendations
  - [ ] Registration management within user dashboard
- [ ] **Waitlist & Notifications**
  - [ ] Join waitlists for full registrations
  - [ ] Email notifications for available spots
  - [ ] Waitlist position tracking

#### **Phase 3.5: User Onboarding Enhancement** 👤 **(NEW PRIORITY)**
- [ ] **First-Time User Onboarding Flow**
  - [ ] Create user onboarding flow for first-time login to capture required profile info
  - [ ] Build onboarding form with first/last name validation (required fields)
  - [ ] Pre-populate onboarding form with Google OAuth data when available
  - [ ] Add logic to detect new users and redirect to onboarding vs dashboard
  - [ ] Ensure smooth UX for both magic link and OAuth authentication methods

#### **Phase 4: Payment Integration & Core Features** 💳 **(NEXT PRIORITY)**
- [ ] **Stripe Payment Integration**
  - [ ] Set up Stripe configuration and webhooks
  - [ ] Integrate payment processing into membership purchase flow
  - [ ] Handle payment success/failure states and user feedback
  - [ ] Create payment records and link to user_memberships
- [ ] **Core Feature Completion**
  - [ ] Registration pricing tiers system (early bird, regular, late pricing)
  - [ ] Add membership type editing functionality (update pricing, descriptions, accounting codes)
  - [ ] Add registration category editing functionality (capacity, membership requirements)

#### **Future Enhancements** 🔮
- [ ] Discount codes system for memberships and registrations
- [ ] Loops.so email integration for automated communications
- [ ] Admin reporting and analytics dashboard
- [ ] Renewal notifications and easy renewal flow
- [ ] Upgrade/downgrade between membership types

### ⚠️ Security Items to Address
- [x] **COMPLETED**: Fix user_memberships RLS policies to allow user INSERT/UPDATE operations
- [ ] **HIGH PRIORITY**: Fix admin RLS policies to only allow actual admins (currently allows all authenticated users)

---

*Last updated: June 16, 2025*
*Status: **Phase 2 Complete** - Membership Purchase Flow with Smart Extension Logic + Expiration Warning System*

## Recent Achievements (June 16, 2025)
✅ **Phase 1: Complete User Dashboard Implementation**
- Built comprehensive user dashboard with account management, membership viewing, and registration browsing
- Implemented hybrid admin/user role switching with intuitive toggle interface
- Added security-first defaults (all users start in member view, admins toggle to admin mode when needed)
- Created responsive navigation with mobile support and real-time data integration

✅ **Phase 2: Complete Membership Purchase Flow**
- Implemented duration selection UI (3, 6, 12 months) with smart pricing calculations
- Built smart date extension logic - seamlessly extends existing memberships without gaps or overlaps
- Added visual indicators for membership extensions vs new purchases
- Fixed RLS policies to allow users to insert/update their own memberships
- Created test data management tools for development and validation

✅ **Enhancement: Membership Expiration Warning System**
- Implemented 90-day expiration warning indicators with yellow "Expiring Soon" status badges
- Added countdown warnings showing exact days until expiration (⚠️ Expires in X days)
- Applied consistent warning styling across dashboard and membership pages
- Enhanced user experience to prevent accidental membership lapses

📋 **Next Enhancement: User Onboarding Flow**
- **Identified Gap**: Google OAuth auto-fills name fields beautifully, but magic link users start with incomplete profiles
- **Solution**: First-time user onboarding to capture required profile information (first/last name)
- **UX Goal**: Ensure smooth experience regardless of authentication method while maintaining data quality

**Ready for Phase 4: Stripe Payment Integration** - Purchase flow is complete and ready for payment processing integration.