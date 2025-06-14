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
  fiscal_year: integer NOT NULL -- 2025
  is_active: boolean DEFAULT true
  created_at: timestamp
)

memberships (
  id: uuid PRIMARY KEY
  season_id: uuid REFERENCES seasons(id)
  name: text NOT NULL -- "Fall/Winter 2025 Membership"
  price: integer NOT NULL -- in cents
  accounting_code: text
  allow_discounts: boolean DEFAULT true
  created_at: timestamp
)

user_memberships (
  id: uuid PRIMARY KEY
  user_id: uuid REFERENCES users(id)
  membership_id: uuid REFERENCES memberships(id)
  payment_status: text NOT NULL -- "pending" | "paid" | "refunded"
  stripe_payment_intent_id: text
  amount_paid: integer -- in cents
  purchased_at: timestamp
  created_at: timestamp
  
  UNIQUE(user_id, membership_id)
)
```

### Registration System
```sql
registrations (
  id: uuid PRIMARY KEY
  season_id: uuid REFERENCES seasons(id)
  required_membership_id: uuid REFERENCES memberships(id) -- NULL for free events
  name: text NOT NULL -- "Rec League Team A", "Friday Scrimmage"
  type: text NOT NULL -- "team" | "scrimmage" | "event"
  max_capacity: integer
  current_count: integer DEFAULT 0
  accounting_code: text
  allow_discounts: boolean DEFAULT true
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

### Registration Flow
1. User attempts to register for team/event
2. System checks required membership for that season
3. If no membership: redirect to purchase membership + registration
4. If has membership: proceed with registration only
5. Apply current pricing tier based on date
6. Apply discount codes if provided
7. Process payment through configured provider
8. Send confirmation emails

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

### 🚧 In Progress
- [ ] Registration system with capacity management

### 📋 Next Steps
- [ ] Add membership editing functionality (pricing, accounting codes)
- [ ] Registration system with capacity management
- [ ] Stripe payment integration
- [ ] Loops.so email integration
- [ ] Pricing tiers and discount codes
- [ ] Waitlist management
- [ ] Admin reporting features

### ⚠️ Security Items to Address
- [ ] **HIGH PRIORITY**: Fix RLS policies to only allow actual admins (currently allows all authenticated users)

---

*Last updated: December 14, 2025*
*Status: Season & Membership Management Complete*