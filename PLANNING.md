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

## 📋 Current Development Phases

### ✅ **COMPLETED PHASES**

#### **✅ Phase 1: Core Foundation - COMPLETED**
- [x] Next.js project setup with TypeScript and Tailwind CSS
- [x] Supabase integration and database schema creation
- [x] Authentication system (magic links + Google OAuth)
- [x] User management with admin roles and Row Level Security
- [x] Season, membership, and registration management systems
- [x] User dashboard with account management

#### **✅ Phase 2: Membership Purchase System - COMPLETED** 💳
- [x] **Membership Purchase Flow**: Complete purchase workflow with duration selection
- [x] **Stripe Payment Integration**: Payment intents, Elements UI, webhook processing
- [x] **Smart Date Extension**: Seamless membership extension logic
- [x] **Purchase History**: Consolidated membership display with transaction records
- [x] **Email Integration**: Loops.so transactional emails with purchase confirmations
- [x] **Toast Notifications**: Enhanced user feedback throughout purchase flow
- [x] **Three-Option Payment System**: Financial assistance, donation support, and standard payment options

#### **✅ Phase 2.5: User Onboarding Enhancement - COMPLETED** 🎯
- [x] **Onboarding Flow**: Complete form with name collection, terms acceptance, membership upsell
- [x] **Legal Compliance**: Terms & Conditions, Code of Conduct, Privacy Policy
- [x] **Secure Middleware**: Prevents route access until onboarding completion
- [x] **Enhanced Login UX**: Toast notifications, disabled buttons, error handling

#### **✅ Phase 3: Account Deletion & Privacy Compliance - COMPLETED** 🗑️
- [x] **Complete Authentication Prevention**: Auth.users deletion prevents all login methods
- [x] **Business Data Preservation**: Orphaned user records maintain payment/membership history
- [x] **Clean Re-registration**: Same email can create new account with fresh UUID
- [x] **Two-Step Security Process**: Warning screen + typed verification
- [x] **Email Confirmation**: Deletion confirmation sent before account processing

#### **✅ Phase 4: Error Monitoring & Reliability - COMPLETED** ⚠️
- [x] **Sentry Integration**: Comprehensive error tracking for critical operations
- [x] **Payment Error Monitoring**: Specialized tracking for payment processing failures
- [x] **Account Deletion Monitoring**: Step-by-step error tracking with context
- [x] **Critical Error Classification**: Fatal-level alerts for business-critical failures
- [x] **Contextual Error Data**: User, payment, and operation context in all error reports

### 🚧 **IN PROGRESS / NEXT PHASES**

#### **✅ Phase 5: Registration Purchase System - COMPLETED** 🏒
- [x] **Basic Registration Display**: Show available registrations with membership requirements
- [x] **Eligibility Checking**: Visual indicators for registration access requirements
- [x] **Registration Purchase Flow**: Complete category selection with dynamic pricing and payment processing
- [x] **Information Architecture Separation**: Clear distinction between "My" pages (viewing) and "Browse" pages (purchasing)
- [x] **Enhanced Admin Management**: Comprehensive registration management system with timing controls

#### **✅ Phase 5.5: Advanced Registration Management - COMPLETED** ⏰
- [x] **Registration Timing System**: Pre-sale, general, and end date controls with validation
- [x] **Publication Status Control**: Draft/published state with admin workflow protection
- [x] **Status-Based Organization**: Collapsible sections by registration state (Draft/Active/Coming Soon/Expired)
- [x] **Registration Category Pricing**: Direct category-based pricing with admin price management
- [x] **Inline Admin Editing**: Quick registration name editing with real-time updates
- [x] **Category Edit Workflow**: Complete CRUD operations for registration categories
- [x] **Comprehensive Status Logic**: 5-state system (draft/coming_soon/presale/open/expired) with proper timing validation

#### **✅ Phase 5.7: Enhanced Membership Validation & UX - COMPLETED** 🎯
- [x] **Season-Long Membership Validation**: Enhanced validation ensuring membership covers entire season duration
- [x] **Smart Expiration Logic**: Fixed validation to use latest membership expiration date (not first found)
- [x] **Membership Extension Warnings**: Yellow warning system with guidance for insufficient coverage
- [x] **Honest Category Requirements**: Replaced misleading checkmarks with clear "Requires: X membership" text
- [x] **Consolidated Membership Display**: Show membership types by latest expiration, not purchase count
- [x] **Enhanced Purchase Success Flow**: Toast notifications and success screens with clear next steps
- [x] **Improved Status Indicators**: Consistent 90-day warning logic with proper visual indicators (✅⚠️❌)

#### **✅ Phase 5.8: Registration Email Notifications - COMPLETED** 📧
- [x] **Registration Confirmation Emails**: Send confirmation emails for all successful registrations
- [x] **Email Template Integration**: Complete Loops.so template setup with registration details
- [x] **Waitlist Email Support**: Template and integration ready for future waitlist functionality
- [x] **Email Documentation**: Complete README.md documentation for all email templates
- [x] **API Integration**: Automatic email sending after successful payment confirmation
- [x] **Error Monitoring**: Sentry integration for email delivery failures

#### **✅ Phase 5.9: Registration Count Display Fixes - COMPLETED** 🔢
- [x] **Admin Count Display**: Fixed admin registration detail page to show actual paid registration counts
- [x] **User Capacity Display**: Updated user browse page to show remaining spots instead of total capacity
- [x] **Shared Utility Function**: Created `getCategoryRegistrationCounts()` for consistency across admin and user pages
- [x] **RLS Policy Fix**: Updated Row Level Security policies to allow users to see paid registration counts for capacity planning
- [x] **Capacity Validation Fix**: Updated payment intent creation to only count paid registrations for capacity validation

#### **✅ Phase 5.10: Registration Timing & Presale System - COMPLETED** ⏰
- [x] **User-Side Timing Validation**: Implemented registration timing controls on user browse page (respects draft, coming_soon, presale, open, expired status)
- [x] **Presale Visibility**: Show presale registrations with clear "Pre-Sale" status tags for user awareness
- [x] **Presale Code Functionality**: Added presale code input with real-time validation and case-insensitive matching
- [x] **Status-Based UX**: Appropriate button states and messaging for each registration timing status
- [x] **User Guidance**: Clear messaging and visual indicators for registration availability and requirements

#### **✅ Phase 5.11: Enhanced Presale Code Tracking & Coming Soon UX - COMPLETED** 🎯
- [x] **Presale Code Audit Trail**: Added `presale_code_used` field to `user_registrations` table for complete tracking
- [x] **Registration Purchase Flow**: Updated APIs to capture and store presale codes when used during registration
- [x] **Coming Soon Status Display**: Show "Coming Soon" registrations with disabled state and timing information
- [x] **Smart Timing Messages**: Display when presale or regular registration opens with date/time details
- [x] **Enhanced Browse Page UX**: Clear visual indicators and messaging for all registration timing states

#### **✅ Phase 5.12: Optimized Browse Registration UX - COMPLETED** 🎨
- [x] **Priority-Based Layout**: Moved "Available Teams & Events" to top position for immediate focus
- [x] **Conditional Membership Warnings**: Only show warnings when memberships expire ≤90 days or are missing
- [x] **Clean Interface**: Most users with healthy memberships see streamlined browsing experience
- [x] **Prominent CTA Buttons**: Replaced text links with actionable buttons for membership extension/purchase
- [x] **Early Warning System**: Proactive membership expiration alerts prevent purchase-time friction

#### **✅ Phase 6: Comprehensive Waitlist System - COMPLETED** 🎯
- [x] **Complete Waitlist Functionality**: Category-specific waitlist system with position tracking and user management
- [x] **Waitlist Join API**: Full validation, duplicate prevention, and capacity checking with proper error handling
- [x] **Real-time State Management**: User waitlist position tracking and button state management to prevent duplicate joins
- [x] **Email Notifications**: Automatic waitlist confirmation emails using Loops.so template with position and registration details
- [x] **Enhanced UX Design**: Dynamic messaging showing waitlist position instead of generic "sold out" messaging
- [x] **Database Schema Updates**: Category-specific waitlist support with proper RLS policies and migration scripts
- [x] **Visual State Management**: Color-coded warnings (red for sold out, blue for waitlisted) with appropriate icons and messaging
- [x] **Button State Logic**: Disabled states for waitlisted users with clear position display in button text
- [x] **Waitlist Visibility**: Show the user's waitlisted registrations on the dashboard under recent registrations and also on the my registrations page.

**Note**: Waitlists and user registrations are independent systems by design. Deleting a registration does not automatically remove waitlist entries, allowing for manual admin control over waitlist management.

#### **✅ Phase 7: Critical Registration Fixes & Discount Codes - COMPLETED** ⚠️
- [x] **Race Condition Protection**: Prevent oversubscription when multiple users register simultaneously for capacity-limited events ✅ **COMPLETED**
  - [x] Implemented 5-minute reservation system for capacity-limited registrations
  - [x] Added `processing` status to `user_registrations` table with expiration timestamps
  - [x] Created atomic spot reservation before payment intent creation
  - [x] Updated registration counting to include valid processing reservations
  - [x] Centralized user registration display logic in APIs (paid registrations only)
  - [x] Added race condition handling with automatic waitlist fallback
  - [x] Created database migration and updated schema.sql
- [x] **Payment Timer & Cleanup System**: Complete countdown timer and processing record cleanup ✅ **COMPLETED**
  - [x] Added 5-minute countdown timer in payment form showing reservation expiration
  - [x] Implemented clean reservation system with modal close cleanup
  - [x] Added timer expiration handling with toast notifications
  - [x] Fixed RLS issues preventing processing record cleanup by creating admin client
  - [x] Added service role key bypass for database cleanup operations
  - [x] Implemented reliable cleanup on modal close and timer expiration
- [x] **Comprehensive Discount Code System**: Advanced category-based discount system with accounting integration ✅ **COMPLETED**
  - [x] **Phase 1: Database & Core APIs** ✅ **COMPLETED**
    - [x] Create discount_categories table (name, accounting_code, max_per_user_per_season)
    - [x] Update discount_codes table to reference categories
    - [x] Update discount_usage table with category tracking
    - [x] Build discount validation API with category limits
    - [x] Update payment processing to handle category-based discounts
  - [x] **Phase 2: Admin Interface & Frontend Integration** ✅ **COMPLETED**
    - [x] Category management pages (CRUD with accounting codes)
    - [x] Code management grouped by category with contextual navigation
    - [x] Individual code creation and editing with category context
    - [x] Frontend integration with registration checkout for discount code input
    - [x] Real-time discount validation with user feedback
    - [x] Category-focused UX removing unnecessary filters when context is clear
    - [x] Clean admin interface with percentage-based ordering and streamlined actions
    - [x] **Partial discount application** for season limits with intelligent UX messaging
  - [ ] **Phase 3: Analytics & Reporting**
    - [ ] Category-based usage tracking dashboard
    - [ ] Per-user season limit enforcement
    - [ ] Xero integration preparation with accounting codes

**Discount Categories System:**
- **Scholarship Fund**: PRIDE100 (100%), PRIDE75 (75%), PRIDE50 (50%), PRIDE25 (25%)
- **Board Member**: Custom percentage codes with board-specific accounting code
- **Captain**: Captain-specific codes with separate accounting tracking
- **Volunteer**: Volunteer recognition codes with volunteer accounting code
- **Per-Category Limits**: e.g., $500 max per user per season for Scholarship Fund
- **Accounting Integration**: Each category maps to specific accounting code for Xero
- **Smart Partial Discounts**: When full discount would exceed season limit, applies partial amount up to remaining allowance with clear messaging
- [x] **Add Donation to Membership Purchase**: Three-option payment system with financial assistance and donation support
- [ ] **Add Donation to Registration Purchase**: Extend donation options to registration checkout flow

#### **Phase 8: Xero Accounting Integration** 🧾
- [ ] **OAuth 2.0 Setup**: Xero app registration with secure token management and refresh capability
- [ ] **Database Schema Extensions**: Add Xero tracking fields and sync status logging to existing tables
- [ ] **Automatic Invoice Creation**: Generate Xero invoices for all purchases (memberships + registrations) with multi-line item support
- [ ] **Contact Management**: Create and sync Xero contacts for users making their first purchase
- [ ] **Stripe Fee Tracking**: Record Stripe processing fees as separate expense items in Xero
- [ ] **Discount Code Integration**: Handle discount codes as negative line items in invoices for clear financial breakdown
- [ ] **Real-time Synchronization**: Webhook integration for automatic sync between systems
- [ ] **Payment Recording**: Link Stripe payments to Xero bank accounts with proper reconciliation
- [ ] **Error Handling & Retry Logic**: Robust error handling for rate limits, authentication, and network issues
- [ ] **Testing & Sandbox**: Complete testing framework using Xero demo company environment

**Business Benefits:**
- Automated bookkeeping eliminating manual invoice entry
- Accurate fee tracking with Stripe processing costs recorded
- Professional invoicing using Xero's templates and delivery system
- Real-time financial data synchronization
- Clear discount transparency and promotional pricing breakdown

#### **Phase 9: Admin Waitlist Management** 📋
- [ ] **Waitlist Dashboard**: Admin interface to view all waitlists by registration and category
- [ ] **Waitlist Position Management**: Ability to manually adjust waitlist positions and remove users
- [ ] **Bypass Code Generation**: Generate single-use bypass codes for waitlisted users
- [ ] **Waitlist Notifications**: Send custom notifications to waitlisted users about status changes
- [ ] **Registration Conversion**: Move users from waitlist to registration when spots become available
- [ ] **Waitlist Analytics**: Reports on waitlist conversion rates and demand patterns

#### **Phase 10: Advanced Features** 🔮
- [ ] **Pricing Tiers**: Early bird, regular, and late pricing for registrations
- [ ] **Email Marketing**: Send marketing and team/event emails through the admin page rather through Mailchimp
- [ ] **Admin Reporting**: Dashboard for payment reconciliation and membership analytics
- [ ] **Content Management**: Admin interface for Terms & Conditions updates
- [ ] **User Management System**: Complete admin interface for managing user accounts, roles, and permissions

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

*Last updated: July 4, 2025*
*Status: **Complete Discount System + Three-Option Membership Payment System** - Full discount functionality with intelligent season limits + flexible membership payment options*

## Recent Achievements (July 4, 2025)

✅ **Three-Option Membership Payment System Implementation**
- **✅ Flexible Payment Options**: Three clear choices - financial assistance, donation support, or standard payment
- **✅ Financial Assistance**: Pay-what-you-can option (0-100% of price, default 50%) for accessibility
- **✅ Community Support**: Optional donations ($1-$1000, default $50) to support other members
- **✅ Dynamic Pricing**: Real-time total calculation with clear breakdown showing membership + assistance/donation
- **✅ Enhanced Purchase Flow**: Conditional inputs with proper validation and required selection
- **✅ Accounting Ready**: Separate payment item records for membership vs donations for clean financial tracking
- **✅ Stripe Integration**: Enhanced metadata and descriptions based on payment type

✅ **Smart Partial Discount System Enhancement**
- **✅ Intelligent Season Limit Handling**: Instead of rejecting discounts that exceed limits, apply partial discounts up to remaining allowance
- **✅ Enhanced User Messaging**: Clear explanations when partial discounts are applied with specific limit information
- **✅ Visual UX Indicators**: Yellow warning icons for partial discounts vs green checkmarks for full discounts
- **✅ Maximized User Benefit**: Users always get the best possible discount within their category limits

## Future Enhancements

🔮 **Membership Purchase Limits**
- **Purchase Time Limits**: Add validation to limit membership purchases to 12-18 months in advance to prevent excessive advance purchases, especially when discounts are available
- **Business Protection**: Prevent users from purchasing unreasonable durations (e.g., 100 years) that could impact system sustainability
- **Implementation**: Add frontend validation and backend enforcement in membership purchase flow

## Previous Achievements (July 3, 2025)

✅ **Complete Category-Based Discount System Implementation**
- **✅ Advanced Admin Interface**: Full CRUD operations for discount categories with accounting codes, spending limits, and descriptions
- **✅ Contextual Code Management**: Category-focused workflow with smart navigation removing filters when context is clear
- **✅ Individual Code Editing**: Complete edit functionality for discount codes with real-time validation and duplicate checking
- **✅ Frontend Integration**: Registration checkout with real-time discount code validation and dynamic pricing display
- **✅ Clean UX Design**: Removed unnecessary clutter (creation dates, usage links) for focused admin workflow
- **✅ Smart Ordering**: Codes ordered by percentage (highest discounts first) for better admin organization
- **✅ Category-Specific Navigation**: "Manage Codes" buttons maintain category context throughout the workflow
- **✅ Comprehensive API Layer**: Full REST APIs for categories and codes with proper validation and error handling
- **✅ Database Naming Discussion**: Documented future technical improvement considerations in PLANNING.md

## Previous Achievements (July 2, 2025)

✅ **Complete Reservation System with Payment Timer Implementation**
- **✅ Atomic Spot Reservation**: 5-minute reservation system preventing race conditions during payment processing
- **✅ Processing Status Architecture**: Added `processing` payment status with expiration timestamps to `user_registrations` table
- **✅ Payment Countdown Timer**: Visual 5-minute countdown in payment form motivating completion and showing reservation status
- **✅ Clean Reservation System**: Modal close triggers cleanup allowing immediate retry with fresh reservation window
- **✅ Timer Expiration Handling**: Toast notifications when timer expires with automatic spot release
- **✅ RLS Issue Resolution**: Fixed Row Level Security preventing cleanup by adding admin client with service role key
- **✅ Reliable Cleanup Operations**: Database operations now use service role key to bypass RLS for processing record deletion
- **✅ Enhanced User Experience**: Seamless payment flow with visual feedback and proper error handling
- **✅ Centralized Registration Counting**: Updated counting logic to include valid processing reservations in capacity calculations
- **✅ API-First User Display**: Centralized user registration display logic ensuring only paid registrations are shown to users
- **✅ Enhanced Duplicate Prevention**: Updated duplicate registration checks to exclude processing records from validation
- **✅ Database Migration & Schema**: Complete migration system with efficient indexing for processing record cleanup
- **✅ URL Utility Helper**: Created reusable `getBaseUrl()` helper eliminating duplicate environment URL logic across components

## Previous Achievements (June 29, 2025)

✅ **Comprehensive Waitlist System Implementation**
- **✅ Category-Specific Waitlist Architecture**: Database schema updates supporting waitlists per registration category with position tracking
- **✅ Complete Waitlist Join API**: Full validation including capacity checking, duplicate prevention, and proper error handling with Sentry monitoring
- **✅ Real-time State Management**: User waitlist position tracking with automatic state updates preventing duplicate join attempts
- **✅ Email Integration**: Automatic waitlist confirmation emails using Loops.so template with position, registration, and category details
- **✅ Enhanced UX Design**: Dynamic messaging system showing user's current waitlist position instead of generic "sold out" messaging
- **✅ Visual State Management**: Intelligent color coding (red for sold out, blue for waitlisted) with appropriate icons and contextual messaging
- **✅ Button State Logic**: Smart disabled states for waitlisted users with clear position display in button text and prevention of duplicate actions

✅ **Enhanced Presale Code Tracking & Coming Soon UX Implementation**
- **✅ Complete Presale Audit Trail**: Added database field and API updates to track which presale codes were used for each registration
- **✅ Coming Soon Registration Display**: Show "Coming Soon" registrations with disabled state and smart timing messages
- **✅ Intelligent Timing Messages**: Display when presale or regular registration opens with precise date/time information
- **✅ Enhanced Registration Status Logic**: Complete 5-state system (draft/coming_soon/presale/open/expired) with proper user guidance

✅ **Optimized Browse Registration UX Implementation**
- **✅ Priority-Based Information Architecture**: Moved "Available Teams & Events" to top position for immediate user focus
- **✅ Conditional Warning System**: Only show membership warnings when action is needed (expiring ≤90 days or missing)
- **✅ Clean Interface Design**: Most users with healthy memberships see streamlined, distraction-free browsing
- **✅ Prominent CTA Implementation**: Converted text links to actionable buttons with hover states and icons
- **✅ Proactive User Experience**: Early membership warnings prevent friction during registration purchase flow

## Previous Achievements Summary (June 29, 2025)

✅ **Enhanced Membership Validation & UX System Implementation**
- **✅ Season-Long Membership Validation**: Smart validation ensuring membership coverage through entire season duration
- **✅ Intelligent Expiration Logic**: Fixed validation to use latest membership expiration (handles extensions correctly)
- **✅ User-Friendly Warning System**: Yellow warning boxes with clear extension guidance and month calculations
- **✅ Honest Requirement Display**: Replaced misleading green checkmarks with neutral "Requires: X membership" text
- **✅ Consolidated Membership Status**: Show membership types by latest expiration, not confusing purchase counts
- **✅ Enhanced Purchase Success Flow**: Toast notifications and success screens with direct registration links
- **✅ Consistent Status Indicators**: 90-day warning logic with proper visual indicators (✅⚠️❌) across all pages

✅ **Advanced Registration Management System Implementation**
- **✅ Registration Timing & Publication Controls**: Complete pre-sale, general, and end date system with draft/published workflow
- **✅ Status-Based Admin Organization**: Intelligent collapsible sections organizing registrations by state (Draft/Active/Coming Soon/Expired)
- **✅ Simplified Pricing Architecture**: Direct category-based pricing replacing complex time-based tiers
- **✅ Enhanced Admin UX**: Inline editing, real-time validation, and comprehensive CRUD operations
- **✅ Information Architecture Separation**: Clear "My" vs "Browse" page distinction for optimal user experience
- **✅ Complete Registration Purchase Flow**: End-to-end category selection, payment processing, and confirmation system

✅ **Database Architecture & Technical Improvements**
- **✅ Membership Validation Utilities**: New membership-validation.ts with proper type safety and season coverage logic
- **✅ Registration Timing Schema**: Added timing fields with proper constraints and validation logic
- **✅ Category Pricing Migration**: Seamless migration from complex pricing tiers to simple category pricing
- **✅ Status Utility System**: Comprehensive 5-state registration status logic with proper date validation
- **✅ Real-time Form Validation**: Date ordering validation with user-friendly warning system

**🎯 Result**: Complete registration system with intelligent membership validation, honest UX, and seamless user flows from membership purchase to registration completion

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

## Previous Achievements Summary (June 23, 2025)

✅ **Account Deletion System Architecture Refinement**
- **✅ OAuth Authentication Bypass Resolution**: Discovered and resolved critical issue where deleted users could still authenticate via Google OAuth
- **✅ Database Architecture Improvement**: Removed unnecessary foreign key constraint between users and auth.users tables for flexible account lifecycle management
- **✅ Complete Auth Prevention**: Implemented auth.users deletion instead of banning for absolute authentication prevention
- **✅ Clean Re-registration**: Enabled same-email account recreation with proper data separation and no linking to historical records
- **✅ Business Data Preservation**: Maintained all payment, membership, and registration history through orphaned user records
- **✅ Production Testing**: Successfully tested complete deletion → authentication prevention → clean re-registration flow

✅ **Comprehensive Error Monitoring Implementation**
- **✅ Sentry Integration**: Complete error tracking system for critical business operations
- **✅ Payment Error Monitoring**: Specialized monitoring for payment processing failures with business-friendly messages
- **✅ Account Deletion Monitoring**: Step-by-step error tracking with contextual data for debugging
- **✅ Critical Error Classification**: Fatal-level alerts for business-critical failures requiring immediate attention
- **✅ Contextual Error Data**: Rich error context including user data, payment details, and operation state

✅ **Registration Email & Count System Implementation**
- **✅ Registration Confirmation Emails**: Complete Loops.so integration with automatic email sending after successful registration
- **✅ Admin Count Display Fix**: Fixed admin registration detail page to show actual paid registration counts instead of hardcoded 0
- **✅ User Capacity Display**: Updated user browse page to show "X spots remaining" instead of total capacity
- **✅ Shared Utility Function**: Created `getCategoryRegistrationCounts()` for consistency across admin and user interfaces
- **✅ RLS Policy Fix**: Updated Row Level Security to allow users to see paid registration counts for capacity planning
- **✅ Capacity Validation**: Fixed payment intent creation to only count paid registrations for accurate capacity management

✅ **Registration Timing & Presale System Implementation**
- **✅ User-Side Timing Validation**: Complete registration timing controls respecting draft, coming_soon, presale, open, and expired status
- **✅ Presale Visibility & Functionality**: Show presale registrations with status tags and working presale code input system
- **✅ Case-Insensitive Presale Codes**: User-friendly presale code validation with real-time feedback
- **✅ Status-Based UX**: Appropriate button states, messaging, and visual indicators for each registration timing status
- **✅ Complete Registration Lifecycle**: Full user experience from presale through open registration with proper state management

## Previous Achievements Summary

For detailed information about all completed features and implementations, see the **Current Development Phases** section above, which provides a comprehensive overview of:

- **Phase 1**: Core Foundation (Next.js, Supabase, Authentication, Admin Systems)
- **Phase 2**: Membership Purchase System (Stripe, Email Integration, Toast Notifications)  
- **Phase 2.5**: User Onboarding Enhancement (Legal Compliance, Secure Middleware)
- **Phase 3**: Account Deletion & Privacy Compliance (Authentication Prevention, Data Preservation)
- **Phase 4**: Error Monitoring & Reliability (Sentry Integration, Critical Error Tracking)

**🎯 Current Status**: Complete registration system with email notifications, timing controls, presale functionality, accurate capacity display, and comprehensive admin management.

### 🚀 **Next Priority Recommendations**
1. **🚨 CRITICAL: Race Condition Protection** - Fix capacity oversubscription race conditions (Phase 6)
2. **Advanced Features** - Pricing tiers, discount codes, waitlist management (Phase 7)
3. **Admin Reporting Dashboard** - Payment reconciliation and membership analytics  
4. **User Experience Enhancements** - Registration history and additional notifications
5. **Content Management** - Admin interface for Terms & Conditions updates