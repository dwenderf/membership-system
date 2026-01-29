# Tournament Registration System

**Status:** Planning - Board Decisions Incorporated
**Created:** 2026-01-21
**Updated:** 2026-01-21 (Updated with Board feedback)
**Priority:** High - Chelsea Challenge 2025 (Memorial Day Weekend)

## Executive Summary

The NYCPHA hosts the Chelsea Challenge tournament annually on Memorial Day Weekend. This tournament features 3-4 divisions (B, C1, C2, D) with up to 6 teams per division. Unlike regular team registrations, tournaments require:

- **Extended participant data collection** (skill level, hockey experience, demographics, positions, jersey size)
- **Configurable questionnaire** (admins define custom questions: text, yes/no, or rating 1-5)
- **Drop-in and team-based registration** (participants can be assigned to teams or register with existing teams)
- **Dynamic pricing** (early bird, regular, late registration)
- **Waitlist management** (after capacity is reached)
- **Privacy-conscious data retention** (manual deletion by admins/users after tournament)

This document proposes integrating tournament functionality into the existing NYCPHA membership system, leveraging existing payment/accounting infrastructure while adding tournament-specific features.

## Goals

### Primary Goals
1. Enable NYCPHA to manage Chelsea Challenge registration entirely through the membership system
2. Collect participant information needed for team assignment and logistics (via configurable questionnaire)
3. Support both drop-in (need team) and team-based registration
4. Integrate with existing Stripe payment and Xero accounting systems
5. Maintain data privacy with manual deletion controls for tournament-specific data

### Secondary Goals
1. Support future tournaments (both hosted and external)
2. Allow non-members to register for tournaments
3. Provide tournament-specific membership types (e.g., "Chelsea Challenge 2025" free membership)
4. Admin interface for team management and participant assignment

### Non-Goals (MVP)
- Automated bracket/schedule generation
- Tournament results tracking
- Real-time scoring or standings
- Public tournament brackets

## Current State

### Existing Infrastructure (Strengths to Leverage)

The membership system has robust infrastructure we can reuse:

**Payment System** (`src/app/api/create-registration-payment-intent/route.ts`)
- Stripe integration with payment intents
- 5-minute reservation system
- Payment status tracking (`awaiting_payment` → `processing` → `paid` → `failed`/`refunded`)
- Partial unique index preventing duplicate paid registrations

**Accounting System** (`src/lib/xero/`)
- Xero invoice staging and sync
- Line item categorization (membership, registration, discount, donation)
- Invoice/payment reconciliation
- Error tracking and retry logic

**Discount System**
- Category-based discounts with per-user limits
- Seasonal discount tracking
- Code-based and category-based discounts

**Waitlist System** (`waitlists` table)
- Position-based queue
- Bypass code generation
- Removal tracking

**Membership System**
- User management (profiles, member IDs)
- Membership types with duration-based pricing
- Membership requirement validation for registrations

**Email System** (Loops.so)
- Staging and batch processing
- Template-based emails
- Delivery tracking

### Current Limitations

**Registration System**
- Designed for teams/scrimmages/events, not tournaments
- Limited participant data collection (no custom fields)
- Single membership requirement per registration (can't specify "any of these qualify")
- No concept of divisions or team assignments
- No dynamic pricing (price is set once for entire registration period)

**Data Model**
- `registrations` table mixes different event types
- No structured participant questionnaire
- No team assignment tracking

## Architecture Decision: Integration vs. Separation

### Decision: Integrated System with Separate Database Tables ✓

**Rationale:**
- ✅ Leverage existing payment, accounting, and email infrastructure
- ✅ Single user authentication and account management
- ✅ Unified admin panel for all NYCPHA operations
- ✅ Cross-promotion: tournament participants can become members
- ✅ Simpler for users: one login, one dashboard
- ✅ Easier to maintain: one codebase, one deployment

**Implementation:**
- Same Next.js application
- Same Supabase authentication
- Same `users` table (all participants have accounts)
- New database tables for tournament-specific data
- New `/tournaments` public pages
- New `/admin/tournaments` admin section
- Tournament registrations appear in user dashboard alongside team registrations

**Why Not a Separate Site:**
- Would require duplicating payment/accounting logic
- Complex user account synchronization
- Confusing for members who participate in both
- More overhead to maintain

## Database Schema

### New Tables

#### `tournaments`
The main tournament record (similar to `registrations` but tournament-specific).

```sql
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                          -- "Chelsea Challenge 2025"
  slug TEXT UNIQUE NOT NULL,                    -- "chelsea-challenge-2025"
  description TEXT,                             -- Full tournament description
  start_date DATE NOT NULL,                     -- 2025-05-24
  end_date DATE NOT NULL,                       -- 2025-05-26

  -- Registration windows
  registration_start_at TIMESTAMPTZ NOT NULL,   -- When registration opens
  registration_end_at TIMESTAMPTZ NOT NULL,     -- When registration closes

  -- Current pricing (updated by pricing tier system)
  current_price INTEGER NOT NULL,               -- Price in cents

  -- Capacity and waitlist
  max_participants INTEGER,                     -- NULL = unlimited
  enable_waitlist BOOLEAN DEFAULT TRUE,

  -- Privacy and data retention
  data_retention_minimum_date DATE,             -- Admins cannot delete data before this date (90 days after tournament recommended)

  -- Visibility
  is_active BOOLEAN DEFAULT FALSE,              -- Draft mode (hidden from public)

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tournaments_slug ON tournaments(slug);
CREATE INDEX idx_tournaments_active ON tournaments(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_tournaments_dates ON tournaments(start_date, end_date);

-- Trigger for updated_at
CREATE TRIGGER set_tournaments_updated_at
  BEFORE UPDATE ON tournaments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE tournaments IS 'Main tournament records (e.g., Chelsea Challenge)';
COMMENT ON COLUMN tournaments.slug IS 'URL-friendly identifier for public pages';
COMMENT ON COLUMN tournaments.current_price IS 'Active price in cents, updated by pricing tier system';
COMMENT ON COLUMN tournaments.data_retention_minimum_date IS 'Minimum date before participant data can be deleted (protects operational data during tournament)';
COMMENT ON COLUMN tournaments.is_active IS 'FALSE = draft mode (hidden from public)';
```

#### `tournament_pricing_tiers`
Dynamic pricing based on date ranges (early bird, regular, late registration).

```sql
CREATE TABLE tournament_pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                           -- "Early Bird", "Regular", "Late Registration"
  price INTEGER NOT NULL,                       -- Price in cents
  start_date TIMESTAMPTZ NOT NULL,              -- When this tier becomes active
  end_date TIMESTAMPTZ NOT NULL,                -- When this tier expires
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure date ranges don't overlap per tournament
  CONSTRAINT valid_date_range CHECK (start_date < end_date)
);

-- Indexes
CREATE INDEX idx_pricing_tiers_tournament ON tournament_pricing_tiers(tournament_id);
CREATE INDEX idx_pricing_tiers_dates ON tournament_pricing_tiers(tournament_id, start_date, end_date);

-- Comments
COMMENT ON TABLE tournament_pricing_tiers IS 'Time-based pricing for tournaments (early bird, regular, late)';
COMMENT ON COLUMN tournament_pricing_tiers.name IS 'Display name for this pricing tier';
```

#### `tournament_divisions`
Skill-level divisions (B, C1, C2, D).

```sql
CREATE TABLE tournament_divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                           -- "B", "C1", "C2", "D"
  description TEXT,                             -- "Advanced competitive level"
  max_teams INTEGER,                            -- e.g., 6 teams max
  sort_order INTEGER DEFAULT 0,                 -- Display order
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tournament_id, name)
);

-- Indexes
CREATE INDEX idx_divisions_tournament ON tournament_divisions(tournament_id);
CREATE INDEX idx_divisions_sort ON tournament_divisions(tournament_id, sort_order);

-- Comments
COMMENT ON TABLE tournament_divisions IS 'Skill-level divisions within a tournament (B, C1, C2, D)';
COMMENT ON COLUMN tournament_divisions.max_teams IS 'Maximum number of teams in this division';
```

#### `tournament_teams`
Teams created by admins for the tournament.

```sql
CREATE TABLE tournament_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id UUID REFERENCES tournament_divisions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,                           -- "Blue Devils", "Red Wings"
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tournament_id, name)
);

-- Indexes
CREATE INDEX idx_teams_tournament ON tournament_teams(tournament_id);
CREATE INDEX idx_teams_division ON tournament_teams(division_id);

-- Comments
COMMENT ON TABLE tournament_teams IS 'Teams created by admins for tournament divisions';
COMMENT ON COLUMN tournament_teams.division_id IS 'Division assignment, can be changed by admins';
```

#### `tournament_questionnaire_fields`
Admin-configurable questionnaire for participant information.

```sql
CREATE TABLE tournament_questionnaire_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,                      -- "backward_skating", "hockey_experience"
  field_label TEXT NOT NULL,                    -- "Backward Skating", "Hockey Experience"
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'yes_no', 'rating')),
  is_required BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,                 -- Display order in form
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tournament_id, field_key)
);

-- Indexes
CREATE INDEX idx_questionnaire_fields_tournament ON tournament_questionnaire_fields(tournament_id);
CREATE INDEX idx_questionnaire_fields_sort ON tournament_questionnaire_fields(tournament_id, sort_order);

-- Comments
COMMENT ON TABLE tournament_questionnaire_fields IS 'Admin-configurable questionnaire fields for tournament registration';
COMMENT ON COLUMN tournament_questionnaire_fields.field_key IS 'Unique key for this field (used in participant_info JSON)';
COMMENT ON COLUMN tournament_questionnaire_fields.field_type IS 'text = free text, yes_no = boolean, rating = 1-5 scale';
```

**Standard Fields (Always Collected):**
The following fields are always collected and don't need to be configured:
- Location (city/state)
- Country
- Pronouns
- Jersey size (S, M, L, XL, XXL, Goalie)
- Positions (LW, RW, C, D, G - multi-select)

**Custom Fields (Admin-Defined):**
Admins can add tournament-specific questions like:
- "Backward Skating" (rating 1-5)
- "Goal Scorer" (rating 1-5)
- "Hockey Experience" (text)
- "Previous Teams" (text)
- "First Time Tournament Participant?" (yes/no)

#### `tournament_registrations`
User registrations for tournaments (payment and participant info).

```sql
CREATE TABLE tournament_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Registration type
  registration_type TEXT NOT NULL CHECK (registration_type IN ('drop_in', 'team')),
  team_id UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,  -- For team registrations

  -- Preferences (for drop-in participants)
  preferred_division_id UUID REFERENCES tournament_divisions(id) ON DELETE SET NULL,

  -- Extended participant info (flexible JSON format)
  participant_info JSONB DEFAULT '{}'::jsonb,
  /*
    Example structure:
    {
      "location": "Brooklyn, NY",
      "country": "USA",
      "pronouns": "they/them",
      "jersey_size": "L",
      "positions": ["LW", "C"],

      // Custom fields (based on tournament_questionnaire_fields)
      "backward_skating": 4,                    // rating (1-5)
      "goal_scorer": 5,                         // rating (1-5)
      "hockey_experience": "5 years recreational, 2 years competitive",  // text
      "previous_teams": "NYC Warriors, Brooklyn Blades",                 // text
      "first_time_participant": true            // yes_no
    }
  */

  -- Payment tracking
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  payment_status TEXT DEFAULT 'awaiting_payment'
    CHECK (payment_status IN ('awaiting_payment', 'processing', 'paid', 'failed', 'refunded')),
  amount_paid INTEGER,                          -- Amount in cents (locked at time of payment)
  reservation_expires_at TIMESTAMPTZ,           -- 5-minute reservation window

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one paid registration per user per tournament
  CONSTRAINT unique_paid_tournament_registration UNIQUE NULLS NOT DISTINCT (
    tournament_id,
    user_id,
    CASE WHEN payment_status = 'paid' THEN payment_status ELSE NULL END
  )
);

-- Indexes
CREATE INDEX idx_tournament_regs_tournament ON tournament_registrations(tournament_id);
CREATE INDEX idx_tournament_regs_user ON tournament_registrations(user_id);
CREATE INDEX idx_tournament_regs_payment ON tournament_registrations(payment_id);
CREATE INDEX idx_tournament_regs_status ON tournament_registrations(payment_status);
CREATE INDEX idx_tournament_regs_team ON tournament_registrations(team_id);

-- GIN index for participant_info JSONB queries (optional, for future filtering)
CREATE INDEX idx_tournament_regs_participant_info ON tournament_registrations USING GIN (participant_info);

-- Trigger
CREATE TRIGGER set_tournament_registrations_updated_at
  BEFORE UPDATE ON tournament_registrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE tournament_registrations IS 'User registrations for tournaments with payment and participant info';
COMMENT ON COLUMN tournament_registrations.registration_type IS 'drop_in = needs team assignment, team = registered with specific team';
COMMENT ON COLUMN tournament_registrations.participant_info IS 'Flexible JSON for tournament-specific questions (positions, experience, jersey size, etc.)';
COMMENT ON COLUMN tournament_registrations.amount_paid IS 'Price locked at time of registration (pricing tiers may change)';
```

#### `tournament_team_members`
Links registered participants to teams (after admin assignment).

```sql
CREATE TABLE tournament_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Team-specific info
  positions TEXT[],                             -- ["LW", "C"] - assigned positions for this team
  jersey_number INTEGER,                        -- Assigned jersey number

  -- Assignment tracking
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),        -- Admin who made the assignment

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, user_id)
);

-- Indexes
CREATE INDEX idx_team_members_team ON tournament_team_members(team_id);
CREATE INDEX idx_team_members_registration ON tournament_team_members(registration_id);
CREATE INDEX idx_team_members_user ON tournament_team_members(user_id);

-- Comments
COMMENT ON TABLE tournament_team_members IS 'Links registered participants to teams after admin assignment';
COMMENT ON COLUMN tournament_team_members.positions IS 'Positions assigned for this team (may differ from preferred)';
COMMENT ON COLUMN tournament_team_members.assigned_by IS 'Admin who assigned this participant to the team';
```

#### `tournament_waitlist`
Waitlist for tournaments that reach capacity.

```sql
CREATE TABLE tournament_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferred_division_id UUID REFERENCES tournament_divisions(id) ON DELETE SET NULL,

  -- Queue management
  position INTEGER NOT NULL,                    -- Position in waitlist (1 = first)
  bypass_code_generated BOOLEAN DEFAULT FALSE,  -- Has bypass code been generated?
  removed_at TIMESTAMPTZ,                       -- NULL = still on waitlist

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique active waitlist entry per user per tournament
  UNIQUE NULLS NOT DISTINCT (tournament_id, user_id, removed_at)
);

-- Indexes
CREATE INDEX idx_tournament_waitlist_tournament ON tournament_waitlist(tournament_id);
CREATE INDEX idx_tournament_waitlist_position ON tournament_waitlist(tournament_id, position)
  WHERE removed_at IS NULL;

-- Comments
COMMENT ON TABLE tournament_waitlist IS 'Waitlist queue for tournaments at capacity';
COMMENT ON COLUMN tournament_waitlist.position IS 'Queue position (1 = first in line)';
COMMENT ON COLUMN tournament_waitlist.removed_at IS 'NULL = active on waitlist, timestamp = removed';
```

#### `tournament_qualifying_memberships`
Junction table for multiple membership types that qualify for a tournament.

```sql
CREATE TABLE tournament_qualifying_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tournament_id, membership_id)
);

-- Indexes
CREATE INDEX idx_qualifying_memberships_tournament ON tournament_qualifying_memberships(tournament_id);
CREATE INDEX idx_qualifying_memberships_membership ON tournament_qualifying_memberships(membership_id);

-- Comments
COMMENT ON TABLE tournament_qualifying_memberships IS 'Defines which membership types qualify for tournament registration';
COMMENT ON COLUMN tournament_qualifying_memberships.membership_id IS 'Membership type that qualifies (e.g., Standard Adult OR Chelsea Challenge 2025)';
```

### Modifications to Existing Tables

#### `payments` - Add tournament line item type

```sql
-- Add 'tournament' to line_item_type enum in xero_invoice_line_items
-- This allows tournament fees to be categorized separately in Xero

-- Migration: Update enum constraint
ALTER TABLE xero_invoice_line_items
  DROP CONSTRAINT IF EXISTS xero_invoice_line_items_line_item_type_check;

ALTER TABLE xero_invoice_line_items
  ADD CONSTRAINT xero_invoice_line_items_line_item_type_check
  CHECK (line_item_type IN ('membership', 'registration', 'discount', 'donation', 'tournament'));

-- Comment
COMMENT ON COLUMN xero_invoice_line_items.line_item_type IS 'Type of line item: membership, registration, discount, donation, tournament';
```

### RLS Policies

Row-level security policies to control data access:

```sql
-- tournaments: Public can view active tournaments
CREATE POLICY "Public can view active tournaments" ON tournaments
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage all tournaments" ON tournaments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_pricing_tiers: Public can view for active tournaments
CREATE POLICY "Public can view pricing tiers" ON tournament_pricing_tiers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tournaments WHERE id = tournament_pricing_tiers.tournament_id AND is_active = TRUE)
  );

CREATE POLICY "Admins can manage pricing tiers" ON tournament_pricing_tiers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_divisions: Public can view for active tournaments
CREATE POLICY "Public can view divisions" ON tournament_divisions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tournaments WHERE id = tournament_divisions.tournament_id AND is_active = TRUE)
  );

CREATE POLICY "Admins can manage divisions" ON tournament_divisions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_teams: Public can view for active tournaments
CREATE POLICY "Public can view teams" ON tournament_teams
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tournaments WHERE id = tournament_teams.tournament_id AND is_active = TRUE)
  );

CREATE POLICY "Admins can manage teams" ON tournament_teams
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_registrations: Users can view their own registrations
CREATE POLICY "Users can view own tournament registrations" ON tournament_registrations
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create tournament registrations" ON tournament_registrations
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own tournament registrations" ON tournament_registrations
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Admins can view all tournament registrations" ON tournament_registrations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can update all tournament registrations" ON tournament_registrations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_team_members: Team members can view their team
CREATE POLICY "Users can view their team assignments" ON tournament_team_members
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage team assignments" ON tournament_team_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_waitlist: Users can view own waitlist status
CREATE POLICY "Users can view own waitlist status" ON tournament_waitlist
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage waitlist" ON tournament_waitlist
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- tournament_qualifying_memberships: Public can view (to check eligibility)
CREATE POLICY "Public can view qualifying memberships" ON tournament_qualifying_memberships
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tournaments WHERE id = tournament_qualifying_memberships.tournament_id AND is_active = TRUE)
  );

CREATE POLICY "Admins can manage qualifying memberships" ON tournament_qualifying_memberships
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );
```

### Entity Relationship Diagram

```
tournaments
├── tournament_pricing_tiers (1:many)
├── tournament_divisions (1:many)
│   └── tournament_teams (1:many via division_id)
├── tournament_teams (1:many)
│   └── tournament_team_members (1:many)
├── tournament_registrations (1:many)
│   ├── users (many:1 via user_id)
│   ├── payments (many:1 via payment_id)
│   └── tournament_team_members (1:1 via registration_id)
├── tournament_waitlist (1:many)
│   └── users (many:1 via user_id)
└── tournament_qualifying_memberships (1:many)
    └── memberships (many:1 via membership_id)
```

## User Experience

### For Tournament Participants

#### Public Tournament Browsing
```
URL: /tournaments

┌─────────────────────────────────────────────────────┐
│ Upcoming Tournaments                                │
│                                                     │
│ ┌───────────────────────────────────────────────┐ │
│ │ Chelsea Challenge 2025                        │ │
│ │ Memorial Day Weekend • May 24-26, 2025       │ │
│ │                                               │ │
│ │ 4 Divisions: B, C1, C2, D                    │ │
│ │ Registration: $150 (Early Bird until 4/1)    │ │
│ │                                               │ │
│ │ [View Details] [Register]                    │ │
│ └───────────────────────────────────────────────┘ │
│                                                     │
│ ┌───────────────────────────────────────────────┐ │
│ │ Boston Pride Tournament                       │ │
│ │ June 15-16, 2025                             │ │
│ │ External tournament (NYCPHA team attending)  │ │
│ │                                               │ │
│ │ [View Details] [Register with Team]          │ │
│ └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### Tournament Detail Page
```
URL: /tournaments/chelsea-challenge-2025

┌──────────────────────────────────────────────────────┐
│ Chelsea Challenge 2025                               │
│ Memorial Day Weekend • May 24-26, 2025              │
│                                                      │
│ [Register Now - $150]                               │
│                                                      │
├──────────────────────────────────────────────────────┤
│ About the Tournament                                 │
│                                                      │
│ Join us for our annual Chelsea Challenge...         │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Divisions                                            │
│                                                      │
│ • B Division - Advanced competitive                 │
│ • C1 Division - Intermediate competitive            │
│ • C2 Division - Intermediate recreational           │
│ • D Division - Beginner friendly                    │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Pricing                                              │
│                                                      │
│ ✓ Early Bird: $150 (until April 1)                 │
│   Regular: $175 (April 2 - May 1)                  │
│   Late: $200 (May 2 - May 15)                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Important Dates                                      │
│                                                      │
│ Registration Opens: March 1, 2025                   │
│ Registration Closes: May 15, 2025                   │
│ Tournament: May 24-26, 2025                         │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Requirements                                         │
│                                                      │
│ ⚠️ NYCPHA membership required                       │
│                                                      │
│ You can register with:                              │
│ • Standard Adult Membership, OR                     │
│ • Chelsea Challenge 2025 Membership (Free)         │
│                                                      │
│ [Purchase Membership]                               │
└──────────────────────────────────────────────────────┘
```

#### Registration Flow
```
Step 1: Check Membership
┌──────────────────────────────────────────────────────┐
│ Membership Required                                  │
│                                                      │
│ ⚠️ You need a membership to register                │
│                                                      │
│ Choose one:                                          │
│ ○ Standard Adult Membership - $400/year            │
│   Full NYCPHA benefits (teams, events, discounts)  │
│                                                      │
│ ○ Chelsea Challenge 2025 Membership - FREE         │
│   Tournament only (no other NYCPHA benefits)       │
│                                                      │
│ [Continue]                                           │
└──────────────────────────────────────────────────────┘

Step 2: Registration Type
┌──────────────────────────────────────────────────────┐
│ How are you registering?                            │
│                                                      │
│ ○ Drop-in (I need to be assigned to a team)        │
│ ○ Team Registration (admin will assign me)         │
│                                                      │
│ [Continue]                                           │
└──────────────────────────────────────────────────────┘

Step 3: Division Preference (drop-in only)
┌──────────────────────────────────────────────────────┐
│ Preferred Division                                   │
│                                                      │
│ ○ B - Advanced competitive                          │
│ ○ C1 - Intermediate competitive                     │
│ ○ C2 - Intermediate recreational                    │
│ ○ D - Beginner friendly                             │
│                                                      │
│ Note: Final division placement is at admin          │
│ discretion based on skill level and team balance.   │
│                                                      │
│ [Continue]                                           │
└──────────────────────────────────────────────────────┘

Step 4: Participant Information
┌──────────────────────────────────────────────────────┐
│ Tell Us About Yourself                              │
│                                                      │
│ Hockey Experience *                                  │
│ ┌──────────────────────────────────────────────┐   │
│ │ 5 years recreational, 2 years competitive... │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
│ Previous Teams                                       │
│ ┌──────────────────────────────────────────────┐   │
│ │ NYC Warriors                          [X]     │   │
│ └──────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────┐   │
│ │ Brooklyn Blades                       [X]     │   │
│ └──────────────────────────────────────────────┘   │
│ + Add team                                           │
│                                                      │
│ Location *                                           │
│ [Brooklyn, NY                          ]            │
│                                                      │
│ Country *                                            │
│ [USA                                   ▼]           │
│                                                      │
│ Pronouns *                                           │
│ [they/them                             ▼]           │
│                                                      │
│ Jersey Size *                                        │
│ ○ S  ○ M  ○ L  ○ XL  ○ XXL  ○ Goalie              │
│                                                      │
│ Positions * (select all that apply)                 │
│ ☑ Left Wing (LW)                                    │
│ ☑ Center (C)                                        │
│ ☐ Right Wing (RW)                                   │
│ ☐ Defense (D)                                       │
│ ☐ Goalie (G)                                        │
│                                                      │
│ [Back] [Continue]                                    │
└──────────────────────────────────────────────────────┘

Step 5: Review and Payment
┌──────────────────────────────────────────────────────┐
│ Review Your Registration                            │
│                                                      │
│ Tournament: Chelsea Challenge 2025                  │
│ Division Preference: C1                             │
│ Registration Type: Drop-in                          │
│                                                      │
│ Cost: $150.00 (Early Bird Rate)                     │
│                                                      │
│ ☐ I agree to the tournament rules and code of      │
│   conduct                                            │
│                                                      │
│ [Stripe Payment Form]                               │
│                                                      │
│ [Pay $150.00]                                        │
└──────────────────────────────────────────────────────┘

Step 6: Confirmation
┌──────────────────────────────────────────────────────┐
│ ✓ Registration Complete!                            │
│                                                      │
│ You're registered for Chelsea Challenge 2025       │
│                                                      │
│ What's next?                                         │
│ • You'll receive a confirmation email               │
│ • We'll assign you to a team before the tournament │
│ • You'll be notified when team assignments are made│
│                                                      │
│ [View My Tournaments]                               │
└──────────────────────────────────────────────────────┘
```

#### User Dashboard Integration

```
/dashboard

┌─────────────────────────────────────────────────────┐
│ My Upcoming Events                                  │
│                                                     │
│ 🏒 Spring Scrimmage - March 15                     │
│    Event Registration                              │
│                                                     │
│ 🏆 Chelsea Challenge 2025 - May 24-26             │
│    Tournament Registration                         │
│    Status: Registered (awaiting team assignment)  │
│    Division Preference: C1                         │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ My Teams                                            │
│                                                     │
│ NYCPHA Recreational League                         │
│ 🟢 Team | Full-Time Skater | Alternate            │
│ Fall/Winter 2025                                    │
│                                                     │
│ Chelsea Challenge - Blue Devils                    │
│ 🏆 Tournament Team | C1 Division                   │
│ Memorial Day Weekend 2025                          │
│ Positions: LW, C                                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Flow:**
1. After registration → Appears in "My Upcoming Events" with registration status
2. After admin assigns team → Appears in "My Teams" with team name and division
3. Both tiles remain (registration info + team info)

### For Non-Members

Non-members can:
1. Browse tournaments on public site (no login required)
2. Click "Register" → Prompted to create account
3. Create account → Prompted to get qualifying membership
4. Purchase free "Chelsea Challenge 2025" membership OR standard membership
5. Complete tournament registration

The experience is streamlined but ensures:
- Everyone has a user account (for communication and history)
- Everyone has a membership (for insurance and code of conduct acceptance)
- Tournament-specific membership is free (no barrier for non-members)

## Admin Interface

### Admin Navigation

```
/admin/tournaments

Top-level navigation:
[Memberships] [Registrations] [Tournaments] [Discount Codes] [Seasons] [Accounting] [Reports]
                               ^^^^^^^^^^^^
                               New section
```

### Tournament List Page

```
URL: /admin/tournaments

┌──────────────────────────────────────────────────────────────────┐
│ Tournaments                                    [+ Create Tournament]│
│                                                                    │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Chelsea Challenge 2025                           🟢 Active  │  │
│ │ May 24-26, 2025 • Memorial Day Weekend                      │  │
│ │                                                              │  │
│ │ 45 Registrations (42 paid, 3 pending) | 12 Waitlist        │  │
│ │ 4 Divisions | 16 Teams | 38 Assigned                       │  │
│ │                                                              │  │
│ │ [Manage] [View Registrations] [Manage Teams]              │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Boston Pride Tournament 2025                    🔵 Draft    │  │
│ │ June 15-16, 2025                                            │  │
│ │                                                              │  │
│ │ 0 Registrations | Not yet active                           │  │
│ │                                                              │  │
│ │ [Manage] [Activate]                                        │  │
│ └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Create/Edit Tournament Page

```
URL: /admin/tournaments/new or /admin/tournaments/[id]/edit

┌──────────────────────────────────────────────────────┐
│ Create Tournament                                    │
│                                                      │
│ Basic Information                                    │
│ ───────────────────────────────────────────────     │
│ Tournament Name *                                    │
│ [Chelsea Challenge 2025                    ]        │
│                                                      │
│ URL Slug *                                           │
│ [chelsea-challenge-2025                    ]        │
│                                                      │
│ Description                                          │
│ ┌──────────────────────────────────────────────┐   │
│ │ Join us for our annual Memorial Day...      │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
│ Tournament Dates                                     │
│ ───────────────────────────────────────────────     │
│ Start Date *         End Date *                     │
│ [05/24/2025    ]    [05/26/2025    ]               │
│                                                      │
│ Registration Window                                  │
│ ───────────────────────────────────────────────     │
│ Opens *                  Closes *                   │
│ [03/01/2025 12:00 AM]   [05/15/2025 11:59 PM]     │
│                                                      │
│ Capacity                                             │
│ ───────────────────────────────────────────────     │
│ Maximum Participants                                 │
│ [60                                        ]        │
│ (Leave blank for unlimited)                         │
│                                                      │
│ ☑ Enable waitlist when capacity reached             │
│                                                      │
│ Pricing                                              │
│ ───────────────────────────────────────────────     │
│ Base Price *                                         │
│ [$150.00                                   ]        │
│                                                      │
│ Pricing Tiers (optional)                            │
│ ┌──────────────────────────────────────────────┐   │
│ │ Early Bird | $150 | 3/1/25 - 4/1/25   [Edit]│   │
│ │ Regular    | $175 | 4/2/25 - 5/1/25   [Edit]│   │
│ │ Late       | $200 | 5/2/25 - 5/15/25  [Edit]│   │
│ └──────────────────────────────────────────────┘   │
│ [+ Add Pricing Tier]                                │
│                                                      │
│ Membership Requirements                              │
│ ───────────────────────────────────────────────     │
│ Qualifying Memberships *                             │
│ ☑ Standard Adult Membership                         │
│ ☑ Chelsea Challenge 2025 Membership                 │
│ ☐ LGBTQ+ Membership                                 │
│                                                      │
│ Participant Questionnaire                            │
│ ───────────────────────────────────────────────     │
│ Custom questions for participant registration       │
│ Standard fields (always collected):                 │
│ • Location, Country, Pronouns                       │
│ • Jersey Size, Positions                            │
│                                                      │
│ Custom fields (optional):                           │
│ ┌──────────────────────────────────────────────┐   │
│ │ Backward Skating | Rating (1-5)      [Edit] │   │
│ │ Goal Scorer      | Rating (1-5)      [Edit] │   │
│ │ Hockey Experience| Text              [Edit] │   │
│ │ Previous Teams   | Text              [Edit] │   │
│ │ First Time?      | Yes/No            [Edit] │   │
│ └──────────────────────────────────────────────┘   │
│ [+ Add Custom Question]                             │
│                                                      │
│ Add Custom Question Modal:                          │
│ ┌──────────────────────────────────────────────┐   │
│ │ Question Label *                              │   │
│ │ [Backward Skating                    ]       │   │
│ │                                               │   │
│ │ Question Type *                               │   │
│ │ ○ Text (free-form answer)                    │   │
│ │ ○ Yes/No (boolean)                           │   │
│ │ ● Rating (1-5 scale)                         │   │
│ │                                               │   │
│ │ ☑ Required field                             │   │
│ │                                               │   │
│ │ [Cancel] [Add Question]                      │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
│ Privacy                                              │
│ ───────────────────────────────────────────────     │
│ Data Retention Minimum Date                          │
│ [08/26/2025                                ]        │
│ Admins cannot delete participant data before this  │
│ date (90 days after tournament recommended)        │
│                                                      │
│ Status                                               │
│ ───────────────────────────────────────────────     │
│ ○ Draft (hidden from public)                        │
│ ○ Active (visible and accepting registrations)     │
│                                                      │
│ [Cancel] [Save Tournament]                          │
└──────────────────────────────────────────────────────┘
```

### Tournament Dashboard

```
URL: /admin/tournaments/[id]

Tabs: [Overview] [Registrations] [Divisions & Teams] [Waitlist] [Questionnaire] [Settings]

Tab: Overview
┌──────────────────────────────────────────────────────┐
│ Chelsea Challenge 2025                     🟢 Active │
│ Memorial Day Weekend • May 24-26, 2025              │
│                                                      │
│ Quick Stats                                          │
│ ───────────────────────────────────────────────     │
│ 45 Total Registrations                              │
│ ├─ 42 Paid ($6,300)                                │
│ ├─ 2 Pending                                        │
│ └─ 1 Failed                                         │
│                                                      │
│ 12 On Waitlist                                      │
│                                                      │
│ 4 Divisions                                          │
│ 16 Teams Created                                     │
│ 38 Participants Assigned to Teams                   │
│ 7 Awaiting Team Assignment                          │
│                                                      │
│ Current Price: $175 (Regular)                       │
│ Next Tier: Late ($200) on May 2                    │
│                                                      │
│ [View Detailed Reports]                             │
└──────────────────────────────────────────────────────┘

Tab: Registrations
┌──────────────────────────────────────────────────────┐
│ Tournament Registrations                            │
│                                                      │
│ Filters: [All] [Paid] [Pending] [Drop-in] [Team]  │
│ Search: [___________________________] 🔍           │
│                                                      │
│ Export: [CSV] [Excel]                               │
│                                                      │
│ ┌────────────────────────────────────────────────┐ │
│ │ Name         Type    Division Status    Team   │ │
│ ├────────────────────────────────────────────────┤ │
│ │ John Smith   Drop-in C1      ✓ Paid  Blue Dev││ │
│ │ Jane Doe     Drop-in C2      ⏳ Pend  -       ││ │
│ │ Alex Taylor  Team    B       ✓ Paid  Red Wings││ │
│ └────────────────────────────────────────────────┘ │
│                                                      │
│ [Showing 45 of 45 registrations]                    │
└──────────────────────────────────────────────────────┘

Click on a registration → Registration Detail Modal
┌──────────────────────────────────────────────────────┐
│ Registration Details                           [X]   │
│                                                      │
│ John Smith (#1234)                                  │
│ john@example.com | (555) 123-4567                  │
│                                                      │
│ Registration Type: Drop-in                          │
│ Preferred Division: C1                              │
│ Payment Status: ✓ Paid ($150)                      │
│ Registration Date: March 5, 2025                    │
│                                                      │
│ Participant Information                             │
│ ───────────────────────────────────────────────     │
│ Hockey Experience:                                   │
│ 5 years recreational, 2 years competitive          │
│                                                      │
│ Previous Teams:                                      │
│ NYC Warriors, Brooklyn Blades                       │
│                                                      │
│ Location: Brooklyn, NY                              │
│ Country: USA                                         │
│ Pronouns: he/him                                     │
│ Jersey Size: L                                       │
│ Positions: LW, C                                     │
│                                                      │
│ Team Assignment                                      │
│ ───────────────────────────────────────────────     │
│ Current Team: Blue Devils (C1)                      │
│ Assigned: May 1, 2025 by Admin Name                │
│ Positions: LW, C                                     │
│ Jersey #: 12                                         │
│                                                      │
│ [Edit Assignment] [Process Refund] [Close]         │
└──────────────────────────────────────────────────────┘

Tab: Divisions & Teams
┌──────────────────────────────────────────────────────┐
│ Divisions & Teams                  [+ Add Division] │
│                                                      │
│ Division: B - Advanced Competitive                  │
│ ───────────────────────────────────────────────     │
│ Max Teams: 6 | Current: 4 teams                    │
│                                                      │
│ ┌ Blue Devils (10 players) ────────────────────┐  │
│ │ [Manage Roster] [Edit Team]                    │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌ Red Wings (12 players) ───────────────────────┐  │
│ │ [Manage Roster] [Edit Team]                    │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ [+ Add Team to B Division]                          │
│                                                      │
│ Division: C1 - Intermediate Competitive             │
│ ───────────────────────────────────────────────     │
│ Max Teams: 6 | Current: 5 teams                    │
│ ...                                                  │
│                                                      │
└──────────────────────────────────────────────────────┘

Tab: Waitlist
┌──────────────────────────────────────────────────────┐
│ Waitlist (12 people)                                │
│                                                      │
│ Pos Name           Division Email            Action │
│ ─── ────────────── ──────── ──────────────── ────── │
│ 1   Sarah Johnson  C1       sarah@...   [Admit]    │
│ 2   Mike Chen      C2       mike@...    [Admit]    │
│ 3   Lisa Park      D        lisa@...    [Admit]    │
│ ...                                                  │
│                                                      │
│ [Admit] button generates bypass code and sends     │
│ email to user allowing them to register            │
└──────────────────────────────────────────────────────┘
```

### Team Assignment Interface

```
URL: /admin/tournaments/[id]/teams/[teamId]/roster

┌──────────────────────────────────────────────────────┐
│ Blue Devils - C1 Division                           │
│                                                      │
│ Team Roster (10 players)                            │
│ ───────────────────────────────────────────────     │
│ ┌────────────────────────────────────────────────┐ │
│ │ # Name         Positions      Jersey Size      │ │
│ ├────────────────────────────────────────────────┤ │
│ │ 12 John Smith  LW, C          L           [X]  │ │
│ │ 7  Jane Doe    RW, D          M           [X]  │ │
│ │ ...                                             │ │
│ └────────────────────────────────────────────────┘ │
│                                                      │
│ Unassigned Participants (7)                         │
│ ───────────────────────────────────────────────     │
│ Filter by Division Preference: [C1 ▼]              │
│                                                      │
│ Inline skill ratings for quick team balancing:     │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ Name        Positions  Skills (1-5)           Size   Action  │ │
│ ├──────────────────────────────────────────────────────────────┤ │
│ │ Alex Taylor LW, RW     Back:4 Goal:5 Exp:5    XL     [+ Add]│ │
│ │ Chris Lee   C, D       Back:3 Goal:2 Exp:4    L      [+ Add]│ │
│ │ Sam Wilson  LW, C      Back:5 Goal:4 Exp:5    M      [+ Add]│ │
│ │ ...                                                           │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                      │
│ Skill abbreviations:                                │
│ • Back = Backward Skating (rating)                  │
│ • Goal = Goal Scorer (rating)                       │
│ • Exp = Hockey Experience (rating)                  │
│                                                      │
│ Click participant name to see full details modal:   │
│                                                      │
│ ┌────────────────────────────────────────────────┐ │
│ │ Participant Details - Alex Taylor        [X]  │ │
│ │                                               │ │
│ │ Contact: alex@example.com | (555) 123-4567  │ │
│ │ Location: Brooklyn, NY (USA)                 │ │
│ │ Pronouns: they/them                          │ │
│ │                                               │ │
│ │ Positions: LW, RW                            │ │
│ │ Jersey Size: XL                              │ │
│ │                                               │ │
│ │ Skill Ratings:                               │ │
│ │ • Backward Skating: ★★★★☆ (4/5)            │ │
│ │ • Goal Scorer: ★★★★★ (5/5)                 │ │
│ │ • Hockey Experience: ★★★★★ (5/5)           │ │
│ │                                               │ │
│ │ Hockey Experience (text):                    │ │
│ │ 10 years competitive, captain of NYC        │ │
│ │ Warriors for 3 years                         │ │
│ │                                               │ │
│ │ Previous Teams:                              │ │
│ │ NYC Warriors, Brooklyn Blades                │ │
│ │                                               │ │
│ │ [Assign to This Team]  [Close]              │ │
│ └────────────────────────────────────────────────┘ │
│                                                      │
│ Or search all registrations:                        │
│ [Search by name...                      ] 🔍       │
│                                                      │
│ [Back to Teams]                                     │
└──────────────────────────────────────────────────────┘

Note: With 6 teams × 16 players = up to 96 players, inline display makes it easier to compare participants at a glance for team balancing.

When admin clicks [+ Add]:
- Creates record in tournament_team_members
- Updates tournament_registrations.team_id (for reference)
- Sends email notification to participant: "You've been assigned to Blue Devils (C1)!"
- Participant sees team in "My Teams" on dashboard
```

### Bulk Team Assignment (Future Enhancement)

```
URL: /admin/tournaments/[id]/teams/assign-bulk

Drag-and-drop interface for quickly assigning multiple participants:

┌──────────────────────────────────────────────────────┐
│ Bulk Team Assignment                                │
│                                                      │
│ Unassigned (7)    │ Blue Devils (10) │ Red Wings (12)│
│ ─────────────────┼──────────────────┼────────────────│
│                  │                  │                │
│ [Alex Taylor]    │ [John Smith]    │ [Mike Chen]   │
│   C1 | LW, RW    │   LW, C         │   C, D        │
│                  │                  │                │
│ [Chris Lee]      │ [Jane Doe]      │ [Lisa Park]   │
│   C1 | C, D      │   RW, D         │   G           │
│                  │                  │                │
│ ...              │ ...              │ ...            │
│                  │                  │                │
└──────────────────────────────────────────────────────┘

Drag participants between columns to assign/reassign teams
[Save Assignments] button creates all tournament_team_members records
```

## API Endpoints

### Public APIs

#### Tournament Browsing
```
GET /api/tournaments
Returns: Tournament[] (only active tournaments)
Query params: None

Response:
{
  "tournaments": [
    {
      "id": "uuid",
      "name": "Chelsea Challenge 2025",
      "slug": "chelsea-challenge-2025",
      "description": "...",
      "start_date": "2025-05-24",
      "end_date": "2025-05-26",
      "current_price": 15000,
      "max_participants": 60,
      "registered_count": 45,
      "waitlist_count": 12,
      "divisions": [
        { "id": "uuid", "name": "B", "description": "...", "max_teams": 6 }
      ]
    }
  ]
}
```

#### Tournament Detail
```
GET /api/tournaments/[slug]
Returns: Tournament with divisions, pricing tiers, qualifying memberships

Response:
{
  "tournament": { ... },
  "divisions": [ ... ],
  "pricing_tiers": [ ... ],
  "qualifying_memberships": [ ... ],
  "user_eligibility": {
    "has_qualifying_membership": true,
    "can_register": true,
    "already_registered": false
  }
}
```

#### Create Tournament Registration
```
POST /api/tournaments/[id]/register
Body: {
  "registration_type": "drop_in" | "team",
  "team_id": "uuid" (if registration_type = "team"),
  "preferred_division_id": "uuid",
  "participant_info": {
    "hockey_experience": "...",
    "previous_teams": ["..."],
    "location": "...",
    "country": "...",
    "pronouns": "...",
    "jersey_size": "L",
    "positions": ["LW", "C"]
  }
}

Response: {
  "registration_id": "uuid",
  "payment_required": true,
  "amount": 15000,
  "reservation_expires_at": "2025-03-05T12:05:00Z"
}

Errors:
- 400: Missing qualifying membership
- 409: Already registered
- 410: Tournament at capacity (add to waitlist)
- 422: Validation errors
```

#### Create Payment Intent
```
POST /api/create-tournament-payment-intent
Body: {
  "tournament_registration_id": "uuid"
}

Response: {
  "client_secret": "pi_xxx_secret_yyy",
  "payment_intent_id": "pi_xxx",
  "amount": 15000
}

Process:
1. Validate registration exists and is in awaiting_payment status
2. Check reservation hasn't expired (5-minute window)
3. Create Stripe payment intent
4. Create payments record
5. Create Xero staging records (invoice + line items)
6. Link payment to tournament_registration
7. Return client secret for Stripe Elements
```

#### Confirm Payment
```
POST /api/confirm-tournament-payment
Body: {
  "payment_intent_id": "pi_xxx"
}

Response: {
  "success": true,
  "tournament_registration_id": "uuid"
}

Process:
1. Verify payment intent succeeded in Stripe
2. Update tournament_registration.payment_status = 'paid'
3. Update payment.status = 'completed'
4. Trigger Xero sync
5. Send confirmation email via Loops
6. Check if participant needs team assignment notification
```

#### User's Tournament Registrations
```
GET /api/my-tournament-registrations
Returns: TournamentRegistration[] for authenticated user

Response:
{
  "registrations": [
    {
      "id": "uuid",
      "tournament": { "name": "...", "start_date": "...", ... },
      "registration_type": "drop_in",
      "preferred_division": { "name": "C1" },
      "payment_status": "paid",
      "amount_paid": 15000,
      "team_assignment": {
        "team": { "name": "Blue Devils", "division": "C1" },
        "positions": ["LW", "C"],
        "jersey_number": 12
      } | null,
      "created_at": "2025-03-05T12:00:00Z"
    }
  ]
}
```

### Admin APIs

#### Tournament Management
```
POST /api/admin/tournaments
PUT /api/admin/tournaments/[id]
DELETE /api/admin/tournaments/[id]
Body: Tournament creation/update data

Standard CRUD operations for tournaments
```

#### Division Management
```
POST /api/admin/tournaments/[id]/divisions
PUT /api/admin/divisions/[id]
DELETE /api/admin/divisions/[id]
Body: { name, description, max_teams, sort_order }
```

#### Team Management
```
POST /api/admin/tournaments/[id]/teams
PUT /api/admin/teams/[id]
DELETE /api/admin/teams/[id]
Body: { name, division_id }
```

#### Team Assignment
```
POST /api/admin/teams/[teamId]/members
Body: {
  "registration_id": "uuid",
  "positions": ["LW", "C"],
  "jersey_number": 12
}

DELETE /api/admin/teams/[teamId]/members/[userId]
Removes user from team (doesn't refund registration)
```

#### Pricing Tiers
```
POST /api/admin/tournaments/[id]/pricing-tiers
PUT /api/admin/pricing-tiers/[id]
DELETE /api/admin/pricing-tiers/[id]
Body: { name, price, start_date, end_date }
```

#### Qualifying Memberships
```
POST /api/admin/tournaments/[id]/qualifying-memberships
Body: { "membership_id": "uuid" }

DELETE /api/admin/tournaments/[id]/qualifying-memberships/[membershipId]
```

#### Registration Reports
```
GET /api/admin/tournaments/[id]/registrations
Returns: Full registration list with participant info
Query params:
  - status: paid | pending | failed | refunded
  - registration_type: drop_in | team
  - division_id: uuid
  - has_team: true | false (assigned to team or not)

Response:
{
  "registrations": [
    {
      "id": "uuid",
      "user": { "first_name": "...", "last_name": "...", "email": "...", "member_id": "..." },
      "registration_type": "drop_in",
      "preferred_division": { ... },
      "participant_info": { ... },
      "payment_status": "paid",
      "amount_paid": 15000,
      "team_assignment": { ... } | null,
      "created_at": "..."
    }
  ],
  "summary": {
    "total": 45,
    "paid": 42,
    "pending": 2,
    "failed": 1,
    "revenue": 630000,
    "assigned_to_teams": 38,
    "awaiting_assignment": 7
  }
}
```

#### Export Registrations
```
GET /api/admin/tournaments/[id]/registrations/export
Query params: format=csv | xlsx
Returns: File download

CSV columns:
- Member ID, First Name, Last Name, Email, Phone
- Registration Type, Preferred Division, Payment Status, Amount Paid
- Hockey Experience, Previous Teams, Location, Country, Pronouns
- Jersey Size, Positions
- Team Assignment, Division, Jersey Number
- Registration Date
```

#### Waitlist Management
```
POST /api/admin/tournaments/[id]/waitlist/[userId]/admit
Generates bypass code and sends email to user

DELETE /api/admin/tournaments/[id]/waitlist/[userId]
Removes user from waitlist
```

## Integration with Existing Systems

### Payment Integration (Stripe)

**Reuse Existing Pattern:**
- Use same payment intent creation flow as `create-registration-payment-intent`
- Use same webhook handler for `payment_intent.succeeded`
- Use same reservation system (5-minute timer)
- Same status transitions: `awaiting_payment` → `processing` → `paid`

**New Tournament-Specific Logic:**
```typescript
// src/app/api/create-tournament-payment-intent/route.ts

export async function POST(request: Request) {
  // 1. Validate user has qualifying membership for tournament
  const qualifyingMemberships = await getQualifyingMemberships(tournamentId)
  const userMemberships = await getUserActiveMemberships(userId)
  const hasQualifying = userMemberships.some(m =>
    qualifyingMemberships.includes(m.membership_id)
  )
  if (!hasQualifying) {
    return NextResponse.json({ error: 'Membership required' }, { status: 400 })
  }

  // 2. Check tournament capacity
  const { count } = await supabase
    .from('tournament_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')

  if (tournament.max_participants && count >= tournament.max_participants) {
    // Add to waitlist
    return NextResponse.json({ error: 'Tournament at capacity', waitlist: true }, { status: 410 })
  }

  // 3. Get current price from active pricing tier
  const currentPrice = await getCurrentTournamentPrice(tournamentId)

  // 4. Create payment intent (same as existing)
  const paymentIntent = await stripe.paymentIntents.create({
    amount: currentPrice,
    currency: 'usd',
    customer: stripeCustomerId,
    metadata: {
      tournament_registration_id: registrationId,
      tournament_id: tournamentId,
      user_id: userId,
      type: 'tournament'
    }
  })

  // 5. Create payment record
  const { data: payment } = await supabase
    .from('payments')
    .insert({
      user_id: userId,
      amount: currentPrice,
      stripe_payment_intent_id: paymentIntent.id,
      status: 'pending'
    })
    .select()
    .single()

  // 6. Update tournament_registration with payment link
  await supabase
    .from('tournament_registrations')
    .update({
      payment_id: payment.id,
      payment_status: 'awaiting_payment',
      amount_paid: currentPrice,
      reservation_expires_at: new Date(Date.now() + 5 * 60 * 1000)
    })
    .eq('id', registrationId)

  // 7. Stage Xero invoice
  await stageXeroInvoice({
    userId,
    paymentId: payment.id,
    lineItems: [
      {
        description: `${tournament.name} - Tournament Registration`,
        quantity: 1,
        unitAmount: currentPrice / 100,
        accountCode: tournament.accounting_code || '400',
        lineItemType: 'tournament'
      }
    ]
  })

  return NextResponse.json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: currentPrice
  })
}
```

**Webhook Processing:**
```typescript
// src/app/api/stripe-webhook/route.ts
// Add tournament payment handling to existing webhook

case 'payment_intent.succeeded':
  const metadata = paymentIntent.metadata

  if (metadata.type === 'tournament') {
    // Update tournament_registration
    await supabase
      .from('tournament_registrations')
      .update({ payment_status: 'paid' })
      .eq('id', metadata.tournament_registration_id)

    // Update payment
    await supabase
      .from('payments')
      .update({ status: 'completed' })
      .eq('stripe_payment_intent_id', paymentIntent.id)

    // Send confirmation email
    await sendTournamentConfirmationEmail({
      userId: metadata.user_id,
      tournamentRegistrationId: metadata.tournament_registration_id
    })

    // Trigger Xero sync
    await triggerXeroSync(paymentId)
  }
  break
```

### Accounting Integration (Xero)

**New Line Item Type: `tournament`**

```typescript
// src/lib/xero/invoices.ts

export async function stageXeroInvoice(params: StageInvoiceParams) {
  const lineItems = params.lineItems.map(item => ({
    description: item.description,
    quantity: item.quantity,
    unitAmount: item.unitAmount,
    accountCode: item.accountCode,
    lineItemType: item.lineItemType // 'tournament' for tournament fees
  }))

  // Create staging records (existing pattern)
  const { data: invoice } = await supabase
    .from('xero_invoices')
    .insert({
      user_id: params.userId,
      payment_id: params.paymentId,
      sync_status: 'pending'
    })
    .select()
    .single()

  await supabase
    .from('xero_invoice_line_items')
    .insert(
      lineItems.map(item => ({
        xero_invoice_id: invoice.id,
        ...item
      }))
    )

  return invoice
}
```

**Accounting Code Configuration:**
- Add `accounting_code` column to `tournaments` table (optional)
- Default to '400' (revenue) if not specified
- Admins can specify custom accounting code per tournament (e.g., '410' for tournament revenue)

### Email Integration (Loops)

**New Email Templates:**

1. **Tournament Registration Confirmation**
```
Template ID: LOOPS_TOURNAMENT_REGISTRATION_CONFIRMATION

Variables:
{
  firstName: string
  tournamentName: string
  startDate: string
  endDate: string
  amountPaid: string
  registrationType: "drop-in" | "team"
  preferredDivision: string
  dashboardUrl: string
}

Subject: Registration confirmed for {tournamentName}

Body:
Hi {firstName},

Your registration for {tournamentName} is confirmed!

Tournament Details:
• Dates: {startDate} - {endDate}
• Registration Type: {registrationType}
• Preferred Division: {preferredDivision}
• Amount Paid: ${amountPaid}

What's Next?
- We'll assign you to a team before the tournament
- You'll receive an email notification when team assignments are made
- View your registration anytime in your dashboard

[View My Tournaments]

Questions? Contact us at ...

Thanks for participating!
```

2. **Team Assignment Notification**
```
Template ID: LOOPS_TOURNAMENT_TEAM_ASSIGNMENT

Variables:
{
  firstName: string
  tournamentName: string
  teamName: string
  divisionName: string
  positions: string
  jerseyNumber: number
  dashboardUrl: string
}

Subject: Team assignment for {tournamentName}

Body:
Hi {firstName},

Good news! You've been assigned to a team for {tournamentName}.

Your Team Assignment:
• Team: {teamName}
• Division: {divisionName}
• Positions: {positions}
• Jersey #: {jerseyNumber}

View your full team roster and tournament details in your dashboard.

[View My Team]

See you on the ice!
```

3. **Waitlist Bypass Code**
```
Template ID: LOOPS_TOURNAMENT_WAITLIST_BYPASS

Variables:
{
  firstName: string
  tournamentName: string
  bypassCode: string
  registrationUrl: string
  expiresAt: string
}

Subject: A spot opened up for {tournamentName}!

Body:
Hi {firstName},

Great news! A spot has opened up for {tournamentName}.

You were on the waitlist and now have 48 hours to complete your registration using this special code:

{bypassCode}

This code expires on {expiresAt}.

[Register Now]

Don't wait - this is your chance to join!
```

**Email Staging:**
```typescript
// src/lib/email/tournament-emails.ts

export async function sendTournamentConfirmationEmail(params: {
  userId: string
  tournamentRegistrationId: string
}) {
  const registration = await getTournamentRegistration(params.tournamentRegistrationId)
  const user = await getUser(params.userId)
  const tournament = await getTournament(registration.tournament_id)

  await supabase
    .from('email_logs')
    .insert({
      user_id: params.userId,
      email_type: 'tournament_confirmation',
      template_id: process.env.LOOPS_TOURNAMENT_REGISTRATION_CONFIRMATION!,
      template_data: {
        firstName: user.first_name,
        tournamentName: tournament.name,
        startDate: formatDate(tournament.start_date),
        endDate: formatDate(tournament.end_date),
        amountPaid: formatCurrency(registration.amount_paid),
        registrationType: registration.registration_type,
        preferredDivision: registration.preferred_division.name,
        dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
      },
      status: 'pending'
    })
}
```

### Dashboard Integration

**My Upcoming Events Tile:**
```typescript
// src/app/dashboard/page.tsx

const upcomingEvents = await Promise.all([
  // Existing: Get user registrations (teams, scrimmages, events)
  getUserRegistrations(userId),

  // New: Get tournament registrations
  getUserTournamentRegistrations(userId)
])

// Merge and sort by date
const allEvents = [
  ...upcomingEvents[0].map(r => ({
    type: 'registration',
    name: r.registration.name,
    date: r.registration.date,
    status: r.payment_status,
    icon: '🏒'
  })),
  ...upcomingEvents[1].map(r => ({
    type: 'tournament',
    name: r.tournament.name,
    date: r.tournament.start_date,
    status: r.payment_status,
    teamAssignment: r.team_assignment,
    icon: '🏆'
  }))
].sort((a, b) => new Date(a.date) - new Date(b.date))
```

**My Teams Tile:**
```typescript
// src/app/dashboard/page.tsx

const myTeams = await Promise.all([
  // Existing: Get teams from registrations
  getUserTeams(userId),

  // New: Get tournament team assignments
  getUserTournamentTeams(userId)
])

// Display both regular teams and tournament teams
const allTeams = [
  ...myTeams[0].map(t => ({
    type: 'team',
    name: t.registration.name,
    season: t.season.name,
    role: t.is_alternate ? 'Alternate' : 'Full-Time',
    icon: '🟢'
  })),
  ...myTeams[1].map(t => ({
    type: 'tournament',
    name: `${t.tournament.name} - ${t.team.name}`,
    division: t.team.division.name,
    positions: t.positions.join(', '),
    icon: '🏆'
  }))
]
```

## Security & Privacy Considerations

### Authentication & Authorization

**Row-Level Security (RLS):**
- All tournament tables have RLS policies
- Public can view only active tournaments
- Users can only view/edit their own registrations
- Admins have full access (enforced by `is_admin` check)

**API Endpoint Security:**
```typescript
// Every API route validates authentication
const session = await getServerSession()
if (!session) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// Admin endpoints check is_admin
const { data: user } = await supabase
  .from('users')
  .select('is_admin')
  .eq('id', session.user.id)
  .single()

if (!user?.is_admin) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### Data Privacy

**Participant Information Protection:**
- `participant_info` JSONB field allows flexible data collection
- Data is scoped to tournament (not shared across tournaments)
- Manual deletion by admins (after minimum retention period)
- Users can delete their own data after tournament ends

**Data Retention Policy: Manual Deletion ✓ DECIDED**

**Minimum Retention Period:**
- Tournaments have a `data_retention_minimum_date` (recommended: 90 days after tournament ends)
- Admins **cannot** delete participant data before this date
- Protects operational data during and immediately after tournament
- Allows time for post-tournament surveys, follow-ups, etc.

**Admin Manual Deletion:**
```
Admin can manually clear participant data:
1. Navigate to /admin/tournaments/[id]
2. Click "Privacy" tab
3. If current date < data_retention_minimum_date:
   - "Clear All Participant Data" button is disabled
   - Message: "Data cannot be deleted until [date] (90 days after tournament)"
4. If current date >= data_retention_minimum_date:
   - "Clear All Participant Data" button is enabled
   - Click button → Confirmation dialog:
     "This will permanently delete all participant info (hockey experience, skill ratings, pronouns, etc.) for all registrations. User accounts and payment records will be preserved."
   - Sets participant_info = '{}' for all tournament_registrations
```

**User Self-Deletion:**
```
User preferences page:
/user/account → Privacy → Tournament Data

"Delete My Tournament Data"
- View list of tournaments you've registered for
- For past tournaments (end_date < today):
  - Checkbox enabled: "Delete my data for [Tournament Name]"
- For upcoming/ongoing tournaments:
  - Checkbox disabled: "Data cannot be deleted until tournament ends"
- "Delete selected" button
- Confirmation: "This will delete your participant information but preserve your payment records."
- Updates participant_info = '{}' for selected registrations
```

**Why Manual vs. Automatic:**
- ✅ Gives admins control over when data is deleted
- ✅ Users can delete their own data proactively
- ✅ No risk of accidental deletion if tournament is rescheduled
- ✅ Simpler implementation (no cron job needed)
- ✅ Complies with data minimization while preserving operational flexibility

### PII Handling

**Data Minimization:**
- Only collect necessary data for tournament operations
- Pronouns, location, jersey size stored in JSONB (easy to wipe)
- Payment info stored in `payments` table (separate from participant info)

**Access Logging (Future Enhancement):**
```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,  -- 'viewed_registration', 'exported_data', etc.
  resource_type TEXT NOT NULL,  -- 'tournament_registration'
  resource_id UUID,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

## Open Questions & TBD Items

### 1. Membership Qualification Method ⚠️ TBD

**Question:** How should we handle multiple qualifying membership types?

**Options:**

**A) Junction Table (Flexible)**
- Use `tournament_qualifying_memberships` table
- Admins select which memberships qualify
- More complex to implement
- System-wide flexibility (could extend to regular registrations later)

**B) Free Tournament Membership (Simple)**
- Create free "Chelsea Challenge 2025" membership
- All participants need one membership
- Standard members can get free tournament membership too
- Simpler implementation

**C) Hybrid**
- Use junction table for tournaments
- Keep single `required_membership_id` for regular registrations
- Tournament-specific feature

**Board Input Needed:**
- Is a free tournament membership acceptable?
- Do we want flexibility to require multiple membership types for other events?

### 2. Team Assignment Workflow

**Question:** When should team assignments happen?

**Options:**
- **Manual**: Admins assign teams whenever ready (before tournament)
- **Auto-notify**: System reminds admins when X% of capacity is reached
- **Deadline-based**: Admins must assign by specific date (e.g., 2 weeks before tournament)

**Board Input Needed:**
- How far in advance are teams typically assigned?
- Should we notify participants of a deadline for team assignments?

### 3. Partial Refunds

**Question:** How to handle refunds for tournament registrations?

**Current System:** Full refunds only (marks registration as `refunded`)

**Tournament Considerations:**
- Early cancellations: Full refund?
- Late cancellations: Partial refund or no refund?
- Pricing tier locked at payment time (user paid $150 early bird, now it's $175 regular)

**Board Input Needed:**
- Refund policy for tournaments
- Should system support partial refunds? (requires new logic)

### 4. Data Retention Timeline ✓ DECIDED

**Decision:** Manual deletion only (no automatic deletion)

**Implementation:**
- **Admins:** Can manually delete all tournament participant data, but NOT before `data_retention_minimum_date` (recommended: 90 days after tournament ends)
- **Users:** Can delete their own tournament participant data from user settings, but ONLY after tournament ends
- **No automatic deletion:** Gives admins control, prevents accidental data loss

**What gets deleted:**
- Hockey experience descriptions
- Custom questionnaire responses (skill ratings, etc.)
- Pronouns, jersey size, positions
- Location/country

**What's preserved:**
- Basic user account (name, email)
- Payment records (for accounting)
- Team assignment (historical record)

**Rationale:**
- Simpler to implement (no cron job)
- More control for admins and users
- Still complies with data minimization
- Protects operational data during tournament

### 5. External Tournaments

**Question:** Should we support tournaments NYCPHA doesn't host?

**Example:** Boston Pride Tournament - NYCPHA sends 2 teams

**Requirements:**
- Team-based registration (admin creates teams, users register for specific teams)
- No division management (external tournament handles divisions)
- Payment tracking for NYCPHA participants
- Simplified workflow compared to hosted tournaments

**Board Input Needed:**
- Is this in scope for MVP?
- Or defer to future enhancement (Phase 5)?

**Note:** Architecture will support external tournaments (team-based registration model is the same), but implementation is deferred until Chelsea Challenge is complete.

### 6. Position Validation

**Question:** Should we validate that teams have balanced positions?

**Example:** Ensure each team has at least 1 goalie, X forwards, Y defense

**Options:**
- **No validation**: Admins assign freely
- **Warnings**: System warns if team composition is unbalanced
- **Hard limits**: Can't assign without meeting requirements

**Board Input Needed:**
- Important for Chelsea Challenge?
- Or just helpful for admins?

### 7. Jersey Number Assignment

**Question:** Who assigns jersey numbers?

**Options:**
- **System**: Auto-assign sequential (1, 2, 3, ...)
- **Admin**: Admin inputs jersey number when assigning to team
- **Player**: Player selects preferred jersey number during registration

**Board Input Needed:**
- How are jersey numbers currently assigned?
- Should we track retired/unavailable numbers?

## Implementation Phases

### Phase 1: Core Tournament System (MVP)
**Goal:** Support Chelsea Challenge 2025 registration

**Deliverables:**
- Database migration with all tables (including `tournament_questionnaire_fields`)
- Public tournament browsing and detail pages (`/tournaments`, `/tournaments/[slug]`)
- **Questionnaire builder:** Admin can define custom questions (text, yes/no, rating 1-5)
- Tournament registration flow (membership check, standard fields + custom questionnaire, payment)
- Payment integration (Stripe payment intent for tournaments)
- Accounting integration (Xero line item type: `tournament`)
- Admin tournament CRUD (`/admin/tournaments`)
- Admin division and team management
- Basic registration reports (list, search, export CSV)
- Email confirmations (registration complete)
- Dashboard integration (show tournaments in "My Upcoming Events")

**Testing:**
- End-to-end registration flow
- Payment processing
- Xero invoice creation
- Email delivery

**Timeline Consideration:** Not estimating duration - Board to prioritize based on Memorial Day deadline

### Phase 2: Team Assignment
**Goal:** Enable admins to assign participants to teams

**Deliverables:**
- Team assignment interface (`/admin/tournaments/[id]/teams/[teamId]/roster`)
- Add/remove participants from teams
- Position and jersey number assignment
- Team assignment email notification
- Update dashboard to show team assignments in "My Teams" tile
- Unassigned participants view (filter by division preference)

**Testing:**
- Team assignment workflow
- Email notifications
- Dashboard display

### Phase 3: Waitlist & Capacity Management
**Goal:** Handle tournament capacity and waitlist

**Deliverables:**
- Capacity enforcement (reject registrations when full)
- Automatic waitlist addition
- Waitlist management interface (`/admin/tournaments/[id]/waitlist`)
- Bypass code generation
- Waitlist admission email
- Position tracking in waitlist

**Testing:**
- Capacity enforcement
- Waitlist flow (add → admit → register)
- Bypass code functionality

### Phase 4: Advanced Features
**Goal:** Polish and enhancements

**Deliverables:**
- Dynamic pricing tier automation (update current_price based on date)
- Bulk team assignment (drag-and-drop)
- Advanced reporting (division balance, position distribution, jersey size summary, skill rating distributions)
- Excel export (formatted roster sheets)
- **Manual participant data deletion:**
  - Admin: "Clear All Participant Data" button (disabled until after `data_retention_minimum_date`)
  - User: Self-delete tournament data in user settings (enabled after tournament ends)
- Refund handling for tournament registrations (reuse existing refund system with reason field)
- Discount code support for tournaments

**Testing:**
- Pricing tier transitions
- Data deletion
- Refunds

### Phase 5: Future Enhancements (Post-MVP)
**Ideas for later consideration:**
- **External tournament support** (architecture supports it - team-based registration with same payment/accounting flow)
  - NYCPHA sends teams to external tournaments (e.g., Boston Pride Tournament)
  - No division management (external tournament handles divisions)
  - Track participants and payments for NYCPHA teams
- Tournament brackets and schedules
- Team messaging/announcements
- Post-tournament surveys
- Player ratings/feedback
- Multi-tournament season passes
- Team customization (logos, colors)
- Tournament templates (clone Chelsea Challenge 2025 for 2026)

## Success Metrics

### Adoption Metrics
- Number of tournament registrations vs. previous year (manual process)
- Percentage of registrations completed without admin assistance
- Time saved for admins (estimate based on manual process hours)

### User Experience Metrics
- Registration completion rate (started vs. completed)
- Average time to complete registration
- Support requests related to tournament registration
- User feedback (post-tournament survey)

### Financial Metrics
- Revenue collected via system
- Refund rate
- Payment success rate (Stripe)
- Accounting sync success rate (Xero)

### Operational Metrics
- Team assignment completion rate (% of participants assigned before tournament)
- Waitlist conversion rate (waitlist → registered)
- Data retention compliance (% of expired data deleted on schedule)

## Future Enhancements (Post-MVP)

### 1. Tournament Templates
Create reusable tournament configurations:
- Save Chelsea Challenge 2025 as template
- Clone for Chelsea Challenge 2026
- Pre-populate divisions, pricing structure, questionnaire

### 2. Automated Team Balancing
AI/algorithm to suggest balanced teams based on:
- Skill level (from experience responses)
- Position distribution
- Division preference
- Previous team history (avoid/prefer certain combinations)

### 3. Tournament Communication Hub
- Team-specific message boards
- Tournament-wide announcements
- SMS notifications for urgent updates
- Mobile app integration

### 4. Schedule & Bracket Management
- Create game schedules
- Tournament brackets (single/double elimination, round-robin)
- Real-time score updates
- Live standings

### 5. Player Check-in System
- QR code check-in at tournament
- Track attendance
- Emergency contact info on mobile

### 6. Post-Tournament Features
- Results tracking
- Player awards/recognition
- Photo gallery
- Feedback surveys
- Championship tracking (year over year)

### 7. Merchandise Integration
- Add-ons during registration (t-shirts, hoodies)
- Team-specific merchandise
- Jersey customization (name/number)

### 8. Multi-Sport Support
- Expand beyond hockey
- Sport-specific position lists
- Different rule sets per sport

## Testing Checklist

### Functional Testing

**Public Tournament Flow:**
- [ ] Browse tournaments (only active visible)
- [ ] View tournament details
- [ ] Non-member prompted to get membership
- [ ] Member with qualifying membership can register
- [ ] Drop-in registration flow (division preference, questionnaire)
- [ ] Team registration flow
- [ ] Payment processing (Stripe)
- [ ] Registration confirmation email received
- [ ] Registration appears in "My Upcoming Events"

**Team Assignment Flow:**
- [ ] Admin assigns participant to team
- [ ] Team assignment email sent
- [ ] Team appears in user's "My Teams"
- [ ] User can view team roster

**Capacity & Waitlist:**
- [ ] Registration blocked when at capacity
- [ ] User added to waitlist
- [ ] Admin admits user from waitlist
- [ ] Bypass code email sent
- [ ] User can register with bypass code
- [ ] Position maintained in waitlist queue

**Payment & Accounting:**
- [ ] Payment intent created
- [ ] Reservation timer (5 minutes)
- [ ] Payment succeeds → status updated
- [ ] Xero invoice staged
- [ ] Xero sync completes successfully
- [ ] Invoice appears in Xero with correct line items

**Admin Features:**
- [ ] Create tournament (draft mode)
- [ ] Add divisions
- [ ] Add teams to divisions
- [ ] Create pricing tiers
- [ ] Activate tournament (visible to public)
- [ ] View registrations
- [ ] Export registrations to CSV
- [ ] Process refund

### Security Testing

- [ ] RLS policies prevent unauthorized access
- [ ] Non-admins cannot access `/admin/tournaments`
- [ ] Users can only view own registrations
- [ ] API endpoints validate authentication
- [ ] Admin endpoints validate `is_admin`
- [ ] Payment webhook validates Stripe signature

### Data Privacy Testing

- [ ] Participant data stored in JSONB
- [ ] Data retention date set correctly
- [ ] Cleanup function deletes expired data
- [ ] Manual deletion works (admin)
- [ ] User cannot see other users' participant info

### Integration Testing

- [ ] Stripe payment intent creation
- [ ] Stripe webhook processing
- [ ] Xero invoice staging
- [ ] Xero sync batch processing
- [ ] Loops email staging
- [ ] Loops email delivery

### Performance Testing

- [ ] Tournament list page loads quickly
- [ ] Registration form responsive
- [ ] Admin registration list handles 100+ registrations
- [ ] CSV export completes for large datasets
- [ ] Database indexes effective (query performance)

## Technical Debt & Maintenance

### Database Indexes
All necessary indexes are included in schema above. Monitor query performance and add indexes as needed.

### Cron Jobs
- **Pricing Tier Updates**: Check every hour if pricing tier should change
- **Data Cleanup**: Run daily at 2 AM to delete expired participant data
- **Reminder Emails**: (Future) Send reminders to participants before tournament

### Monitoring
- Track Xero sync failures (same as existing)
- Track email delivery failures (same as existing)
- Monitor tournament registration volume (Stripe dashboard)
- Set up alerts for capacity thresholds (90% full)

### Documentation
- Admin guide: How to create and manage tournaments
- User guide: How to register for tournaments
- API documentation: For potential integrations
- Runbook: Common support scenarios

## Appendix: Related Documentation

- [Database Architecture](../architecture/database.md)
- [Payment System Overview](../features/completed/payment-plans-for-registrations.md)
- [Waitlist Feature](../features/completed/waitlist-feature.md)
- [Email Architecture](../architecture/email-architecture.md)
- [Xero Integration](../features/completed/xero-sync-bugs-and-fixes.md)

## Key Decisions Made

Based on Board feedback and user input, the following decisions have been incorporated:

### ✅ Decision: Waitlist Management - MANUAL
- **Approach:** Admin manually clicks "Admit" to generate bypass code
- **Rationale:** Gives admins control over timing, can coordinate with pricing tiers
- **Status:** Implemented in design

### ✅ Decision: Data Retention - MANUAL DELETION
- **Approach:**
  - **Admins:** Can manually delete all tournament participant data, but NOT before `data_retention_minimum_date` (90 days after tournament recommended)
  - **Users:** Can delete their own tournament data from user settings, but ONLY after tournament ends
  - **No automatic deletion:** Removed cron job, manual control only
- **What gets deleted:** Hockey experience, skill ratings, pronouns, jersey size, positions, location
- **What's preserved:** User account, payment records, team assignment history
- **Rationale:** Simpler implementation, more control, prevents accidental deletion
- **Status:** Implemented in design

### ✅ Decision: Configurable Questionnaire
- **Feature:** Admin-defined custom questions for participant registration
- **Question types:**
  - Text (free-form)
  - Yes/No (boolean)
  - Rating (1-5 scale)
- **Standard fields:** Always collected (location, country, pronouns, jersey size, positions)
- **Custom fields:** Admin adds tournament-specific questions (e.g., "Backward Skating", "Goal Scorer", "Hockey Experience")
- **Display:** Inline in team assignment interface for quick comparison (up to 96 players with 6 teams × 16 players)
- **Status:** Implemented in design (new `tournament_questionnaire_fields` table)

### ✅ Decision: External Tournaments - PHASE 5
- **Approach:** Architecture supports team-based registration for external tournaments
- **Workflow:** Same as hosted tournaments but with team assignment by admins (no divisions)
- **Priority:** Deferred to Phase 5 (post-MVP)
- **Status:** Noted in Future Enhancements

### ⚠️ Still TBD: Membership Qualification Method
- **Options:**
  - A) Free tournament membership (simplest)
  - B) Multiple qualifying memberships via junction table (flexible)
  - C) Hybrid (tournament-specific junction table)
- **Status:** Awaiting Board decision

## Approval & Next Steps

**This document has incorporated initial Board decisions.**

**Remaining Questions for Board:**
1. ✅ Approve integrated approach (vs. separate site)? - **APPROVED in Board summary**
2. ⚠️ Decide on membership qualification method (A, B, or C)?
3. ✅ Confirm manual data retention approach? - **APPROVED**
4. ✅ Prioritize Phase 1 for Chelsea Challenge 2025? - **YES**
5. Any additional features required for MVP?

**After Board Approval:**
1. Resolve open questions (TBD items above)
2. Begin Phase 1 implementation
3. Create test tournament in staging environment
4. Internal testing with NYCPHA board members
5. Launch for Chelsea Challenge 2025 registration

---

**Document Status:** Planning - Board Decisions Incorporated (Waitlist, Data Retention, Questionnaire)
**Next Review Date:** Board meeting TBD
**Owner:** NYCPHA Board
**Implementation Lead:** TBD
**Outstanding Decisions:** Membership qualification method (A, B, or C)
