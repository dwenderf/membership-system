# Captain Access Feature

**Status:** Planning - Approved Architecture
**Created:** 2026-01-17
**Updated:** 2026-01-17
**Priority:** Medium

> **Note:** This document serves as both the planning doc AND the implementation spec. Architecture approved: Captain will be a tab within `/user`, using nested routes (`/user/captain/[id]/*`). Next step: Create UI mockups, then begin Phase 1 implementation.

## Overview

This feature will add captain-level access to the membership system, allowing designated captains to manage their own teams, view registrations, manage alternates, and optionally receive email notifications when members register for their teams.

## Goals

- Enable team captains to view and manage their own teams without requiring full admin access
- Allow captains to manage alternates for their teams
- Provide optional email notifications to captains when members register for their teams
- Support multiple captains per team/registration
- Maintain security by ensuring captains can only access their assigned teams

## Current State

### Existing Infrastructure

Good news! The database already has captain support:

**`registration_captains` table** (created in 2025-08-30 migration):
```sql
CREATE TABLE registration_captains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(registration_id, user_id)
);
```

**RLS Policies** already include captain checks:
```sql
-- Example from alternate system
CREATE POLICY "Captains can view their team alternates" ON user_alternate_registrations
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM registration_captains rc
    WHERE rc.registration_id = user_alternate_registrations.registration_id
    AND rc.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
);
```

**Utility functions** have captain placeholders:
- `src/lib/utils/alternates-access.ts` has `checkAlternatesAccess()` with captain logic partially implemented
- Returns `AlternatesAccessResult` with `isCaptain` and `accessibleRegistrations[]` fields

### What Needs to Be Built

1. Captain UI pages and navigation
2. Middleware to protect captain routes
3. API endpoints for captain operations
4. Captain assignment management (admin functionality)
5. Email notification system for captains
6. Role switching between member/captain modes

## Key Design Decisions

### 1. URL Structure

**Decision: Captain as a tab within `/user` (not a separate top-level route)**

**Rationale:**
- Captain is a permission/feature for members, not a separate role like admin
- Solves admin/captain overlap naturally - admins can just click the Captain tab
- No mode switching needed - just tabs within member dashboard
- Consistent with existing user navigation pattern
- Simpler mental model and UX

**Proposed URL Structure (Option B - Nested):**
```
/user/captain                # Captain dashboard (list of all teams user captains)
/user/captain/[id]           # Team detail/overview page (optional, can add later)
/user/captain/[id]/roster    # View registered members for a team
/user/captain/[id]/alternates # Manage alternates for team
```

**Why nested structure:**
- Groups all team-specific pages under `/user/captain/[id]/*`
- Clear hierarchy: dashboard → team → team features
- Cleaner organization as more features are added
- Mirrors how `/admin` organizes by resource

**Navigation:**
```
User dashboard tabs:
[Dashboard] [Memberships] [Captain] [Registrations] [Invoices] [Account]
                          ↑
                  Only shown if user has captain assignments
```

**API Routes:**
```
/api/user/captain/registrations           # Get all registrations user captains
/api/user/captain/[id]/roster             # Get roster for specific team
/api/user/captain/[id]/alternates         # Manage alternates
```

**Admin Routes for Captain Management:**
```
/admin/registrations/[id]            # Registration detail page (add captain management section)
/admin/registrations/new             # Create registration flow (add captain selection)
/api/admin/registrations/[id]/captains  # API for captain management (CRUD)
```

### 2. Code Reuse vs. Security Isolation

**Recommendation: Create separate captain pages with shared components**

**Architecture:**
- **Separate route handlers** for `/captain/*` and `/admin/*`
- **Shared UI components** where appropriate (e.g., `RosterTable`, `AlternatesManager`)
- **Different API endpoints** with scoped data access
- **Captain-specific middleware** that validates access per registration

**Why this approach:**
- ✅ Security by design - captains can't accidentally access admin-only data
- ✅ Explicit permission checks at every level
- ✅ Code reuse through shared components
- ✅ Easier to audit and test
- ✅ Future-proof for diverging captain vs admin features
- ❌ Some duplication, but acceptable trade-off for security

**Example of shared component:**
```typescript
// src/components/registrations/RosterTable.tsx
export function RosterTable({
  registrationId,
  accessLevel
}: {
  registrationId: string
  accessLevel: 'admin' | 'captain'
}) {
  // Shared UI, different API calls based on accessLevel
}
```

### 3. Registration Type Scope

**Recommendation: Allow captains to manage all registration types (teams, scrimmages, events)**

**Rationale:**
- Captains may lead scrimmage teams or event groups
- More flexible and future-proof
- Database schema already supports this (no type restriction in `registration_captains`)
- Simpler implementation (no type filtering needed)

**Note:** If specific registration types need restriction later, we can add a `allowed_types` column to `registration_captains`.

### 4. Navigation: Tabs Instead of Mode Switching

**Decision: Captain is a tab within `/user`, not a separate mode**

**Implementation:**
```typescript
interface UserRoles {
  isMember: boolean      // Everyone
  isCaptain: boolean     // Has entries in registration_captains
  isAdmin: boolean       // users.is_admin = true
}

// Navigation tabs in /user layout:
// - All users: [Dashboard] [Memberships] [Registrations] [Invoices] [Account]
// - Captains also see: [Captain] tab (shown conditionally)
// - Admins still have separate admin/member toggle for /admin vs /user
```

**Rationale:**
- Captain is a feature/permission, not a role level like admin
- No mode switching confusion - just click the tab you need
- Works seamlessly for admins who are also captains
- Admins can use Captain tab (same view as non-admin captains) OR use admin pages (full access)
- Non-captains who navigate to `/user/captain` see empty state or are redirected

**Empty State for Non-Captains:**
If a non-captain somehow reaches `/user/captain`:
```
You're not assigned as a captain for any teams.

[Return to Dashboard]
```

## Detailed Requirements

### 1. Captain Dashboard (`/user/captain`)

**Features:**
- Display all registrations where user is a captain
- Show registration tiles similar to `/admin/reports/registrations`
- Each tile shows:
  - Registration name and type (Team, Scrimmage, Event)
  - Season
  - Number of registered members
  - Number of alternates (if enabled)
  - Quick links to: View Roster, Manage Alternates
- If user has no captain assignments, show empty state

**API Endpoint:**
```typescript
// GET /api/user/captain/registrations
// Returns: Registration[] filtered by captain access
```

**Mock-up:**
```
My Teams

[Summer 2024 - Softball A Team]
Type: Team | Season: Summer 2024
15 members | 3 alternates
[View Roster] [Manage Alternates]

[Spring Scrimmage - Division B]
Type: Scrimmage | Season: Spring 2024
12 members
[View Roster]
```

**Empty State (non-captains):**
```
You're not assigned as a captain for any teams.

If you believe this is an error, please contact your league administrator.

[Return to Dashboard]
```

### 2. Team Roster Page (`/user/captain/[id]/roster`)

**Features:**
- View all registered members for the team (similar to `/admin/reports/registrations/[id]`)
- Display member information:
  - Name, email, phone
  - Member ID
  - Payment status (Paid, Pending, Failed, Refunded)
  - Registration date
  - User attributes (LGBTQ, Goalie, etc.)
- Show refunded members as greyed out (removed from team but still visible)
- Sortable and searchable table
- Export to CSV (optional, for future)

**Permissions:**
- Can view: Members who registered for captain's team (including refunded)
- Cannot: Edit registrations, process refunds, view specific payment amounts

**Payment Visibility:**
- Show status badges: Paid, Pending, Failed, Refunded
- Show summary counts (e.g., "12 paid, 2 pending, 1 refunded")
- Do NOT show actual dollar amounts
- Refunded members appear greyed out with "Refunded" badge

**API Endpoint:**
```typescript
// GET /api/user/captain/[id]/roster
// Validates captain access before returning data
```

### 3. Alternates Management (`/user/captain/[id]/alternates`)

**Features:**
- Reuse existing `AlternatesManager` component
- Scoped to the specific registration ID in the URL
- Full alternate functionality:
  - Create alternate requests for specific games/dates
  - View members who opted into alternates
  - Select alternates for games
  - Send notifications to selected alternates

**Permissions:**
- Captains can only create/manage alternates for their assigned registrations
- RLS policies already enforce this at database level
- URL access validated: captain must be assigned to registration [id]

**API Endpoints:**
```typescript
// GET /api/user/captain/[id]/alternates      # Get alternate data for registration
// POST /api/user/captain/[id]/alternates/games    # Create new alternate request
// POST /api/user/captain/[id]/alternates/select   # Select members for game
```

**UX Difference from Admin:**
- Admin: `/admin/alternates` shows dropdown to select any registration
- Captain: `/user/captain/[id]/alternates` is already scoped to one registration (from dashboard link)
- Simpler interface with no registration selector needed

### 4. Email Notifications

**New Loops Template: Captain Registration Notification**

**Template ID:** `LOOPS_CAPTAIN_REGISTRATION_NOTIFICATION_TEMPLATE_ID`

**Triggered when:**
- A user completes registration for a team
- The team has one or more captains
- Captains have opted in to notifications

**Template Variables:**
```typescript
{
  captainName: string          // "John"
  registrationName: string     // "Summer 2024 - Softball A Team"
  registrationType: string     // "Team"
  memberName: string           // "Jane Smith"
  memberEmail: string          // "jane@example.com"
  memberPhone?: string         // "(555) 123-4567"
  registrationDate: string     // "January 17, 2026"
  totalMembers: number         // 15
  viewRosterUrl: string        // "https://my.nycpha.org/user/captain/abc-123/roster"
}
```

**Email Content (draft):**
```
Subject: New registration for {registrationName}

Hi {captainName},

Great news! {memberName} just registered for {registrationName}.

Member Details:
- Name: {memberName}
- Email: {memberEmail}
- Phone: {memberPhone}
- Registered: {registrationDate}

Your team now has {totalMembers} registered members.

[View Full Roster]

---
To stop receiving these notifications, update your captain settings.
```

**Implementation:**
- Add `captain_email_notifications` boolean to `registration_captains` table
- Default to `false` (opt-in)
- Add settings page: `/captain/settings` to manage notification preferences
- Trigger email in registration completion webhook

**Note:** This template should be generic enough that admins could also receive it:
- Don't use "captain" in template name, use "team_registration_notification"
- Future feature: Allow admins to subscribe to specific teams

### 5. Captain Assignment (Admin Feature)

**Location:** Integrated into `/admin/registrations/[id]` page

**Features:**

**A) Registration Detail Page - Captain Section**
- Add "Captains" section/tab to existing registration detail page
- List current captains with:
  - Name, email, member ID
  - Date assigned
  - Assigned by (admin name)
  - Email notification status (on/off toggle)
  - [Remove] button
- Add captain interface:
  - Search/autocomplete for user by name, email, or member ID
  - Selected user preview
  - Checkbox: "Enable email notifications" (default: off)
  - [Add Captain] button

**B) Registration Creation Flow**
- Add captain selection step in `/admin/registrations/new`
- Optional field: "Assign Captains" (can skip, add later)
- Same search/select interface as above
- Can add multiple captains during creation
- Email notifications toggle per captain

**C) Registration Reports - Show Captains**
- On `/admin/reports/registrations` page
- Each registration tile shows assigned captains
- Display format: "Captains: John D., Sarah M." (or "No captains assigned")
- Limit to 2-3 names, then "+ X more" if many captains
- Helps admins see at a glance which teams have captain coverage

**API Endpoints:**
```typescript
// GET /api/admin/registrations/[id]/captains        # Get captains for a registration
// POST /api/admin/registrations/[id]/captains       # Add captain
// DELETE /api/admin/registrations/[id]/captains/[userId]  # Remove captain
// PATCH /api/admin/registrations/[id]/captains/[userId]   # Update notification settings
```

**Database Changes Needed:**
```sql
-- Add column for email notification preference
ALTER TABLE registration_captains
ADD COLUMN email_notifications BOOLEAN DEFAULT FALSE;
```

**Email Templates (3 total):**

**Template 1: Captain Assignment**
```
Template ID: LOOPS_CAPTAIN_ASSIGNMENT_NOTIFICATION_TEMPLATE_ID

Subject: You've been assigned as captain for {registrationName}

Hi {captainName},

You've been assigned as a captain for {registrationName}.

As a captain, you can:
- View your team roster
- Manage alternates for games
- Receive notifications when members register (optional)

[Go to Captain Dashboard]

If you have questions, please contact your league administrator.
```

**Template 2: Captain Registration Notification**
(Already defined above in section 4)

**Template 3: Captain Removal**
```
Template ID: LOOPS_CAPTAIN_REMOVAL_NOTIFICATION_TEMPLATE_ID

Subject: Captain access removed for {registrationName}

Hi {captainName},

You've been removed as captain for {registrationName}.

You no longer have access to manage this team, but you can still access your member account and any teams you're registered for.

If you believe this was done in error, please contact your league administrator.

[Go to My Dashboard]
```

## Implementation Phases

### Phase 1: Foundation (MVP)
**Goal:** Core captain access with roster viewing and admin captain management

**Database:**
- [ ] Add `email_notifications` column to `registration_captains` table

**Captain Pages:**
- [ ] Build `/user/captain` dashboard page
  - [ ] API: GET `/api/user/captain/registrations`
  - [ ] UI: Captain dashboard with registration tiles
  - [ ] Empty state for non-captains
- [ ] Build `/user/captain/[id]/roster` page
  - [ ] API: GET `/api/user/captain/[id]/roster`
  - [ ] UI: Roster table with payment status (reuse/adapt admin component)
  - [ ] Show refunded members as greyed out
  - [ ] Validate captain access to registration [id]
- [ ] Add "Captain" tab to user navigation
  - [ ] Update `UserNavigation` to detect captain status
  - [ ] Show/hide tab based on captain assignments
  - [ ] Tab visible to admins if they're also captains

**Admin Pages:**
- [ ] Admin: Captain assignment UI
  - [ ] Add "Captains" section to `/admin/registrations/[id]` page
  - [ ] API: Captain CRUD endpoints (`/api/admin/registrations/[id]/captains`)
  - [ ] UI: List captains, add/remove, toggle notifications
- [ ] Add captain selection to `/admin/registrations/new` (creation flow)
  - [ ] Optional field during registration creation
  - [ ] Can add multiple captains with notification preferences
- [ ] Show captains on registration tiles (`/admin/reports/registrations`)
  - [ ] Display format: "Captains: John D., Sarah M." or "No captains"
  - [ ] Limit to 2-3 names, then "+ X more"

**Email:**
- [ ] Create Loops template for captain assignment
  - [ ] Template ID: `LOOPS_CAPTAIN_ASSIGNMENT_NOTIFICATION_TEMPLATE_ID`
- [ ] Send assignment email when captain is added

**Testing:**
- Assign captain to registration (both in detail page and during creation)
- Captain logs in, sees "Captain" tab in navigation
- Captain clicks tab, sees their teams in dashboard
- Captain views roster, sees only their team's members with correct payment status
- Non-captains see empty state on `/user/captain`
- Admins who are also captains can see Captain tab and use it
- Registration tiles show assigned captains

### Phase 2: Alternates Management
**Goal:** Captains can manage alternates for their teams

- [ ] Build `/user/captain/[id]/alternates` page
  - [ ] Reuse `AlternatesManager` component with captain scope
  - [ ] Pre-scoped to registration ID in URL (no dropdown selector)
- [ ] Create captain-scoped alternate APIs
  - [ ] GET `/api/user/captain/[id]/alternates`
  - [ ] POST `/api/user/captain/[id]/alternates/games`
  - [ ] POST `/api/user/captain/[id]/alternates/select`
- [ ] Update RLS policies if needed (may already be in place)
- [ ] Test captain can only manage alternates for their teams

### Phase 3: Email Notifications
**Goal:** Captains receive notifications when members register

- [ ] Create Loops template for registration notifications
  - [ ] Template ID: `LOOPS_CAPTAIN_REGISTRATION_NOTIFICATION_TEMPLATE_ID`
  - [ ] Test template in Loops dashboard
- [ ] Add environment variable for template ID
- [ ] Update registration completion webhook
  - [ ] Query captains for the registration
  - [ ] Filter captains with `email_notifications = true`
  - [ ] Send email to each captain
  - [ ] Log emails in `email_logs` table
- [ ] Build `/user/captain/settings` page (or integrate into `/user/captain` dashboard)
  - [ ] List all registrations user captains
  - [ ] Toggle email notifications per registration
  - [ ] API: PATCH `/api/user/captain/settings/notifications`

### Phase 4: Polish & Additional Features
**Goal:** Improved UX and admin features

- [ ] Captain removal notification email
  - [ ] Create Loops template (`LOOPS_CAPTAIN_REMOVAL_NOTIFICATION_TEMPLATE_ID`)
  - [ ] Send when captain is removed from registration
- [ ] Export roster to CSV (captain page)
- [ ] Mobile-responsive captain pages
- [ ] Analytics/metrics for captain dashboard
  - [ ] Registrations over time
  - [ ] Alternate usage stats
- [ ] Audit logging for captain actions
- [ ] Possible: Global `/admin/captains` page
  - [ ] List all captains across all registrations
  - [ ] Useful for seeing who has captain access system-wide
  - [ ] Not MVP, but could be helpful later

## Security Considerations

### Authentication & Authorization

**Middleware Checks:**
```typescript
// src/middleware.ts
// Captain routes are under /user/captain, so they inherit /user authentication
// No additional middleware needed for /user/captain/*
// The /user/* routes already require authentication

// However, for better UX, we can check captain status:
if (pathname.startsWith('/user/captain')) {
  // 1. User is already authenticated (from /user check)
  // 2. Check user is a captain of at least one registration
  const { data: captainships } = await supabase
    .from('registration_captains')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)

  // If not a captain, allow access but page will show empty state
  // This is simpler than redirecting and handles edge cases gracefully
}
```

**Note:** Since captain is a tab within `/user`, we don't need strict middleware blocking. Non-captains who navigate to `/user/captain` will simply see an empty state. This is simpler and more user-friendly than hard redirects.

**Per-Registration Access:**
```typescript
// In API routes and page components
async function checkCaptainAccess(userId: string, registrationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('registration_captains')
    .select('id')
    .eq('user_id', userId)
    .eq('registration_id', registrationId)
    .single()

  return !!data
}
```

### Row-Level Security (RLS)

**Verify existing policies cover captain access:**
- `user_registrations` - Captains can view registrations for their teams
- `user_alternate_registrations` - Captains can view/manage alternates
- `alternate_registrations` - Captains can create games
- `alternate_selections` - Captains can select members

**Add new policies if needed:**
```sql
-- Example: Captains can view users who registered for their teams
CREATE POLICY "Captains can view their team members" ON user_registrations
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM registration_captains rc
    WHERE rc.registration_id = user_registrations.registration_id
    AND rc.user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
);
```

### Data Scoping

**Always scope by captain access:**
- API endpoints must validate `registration_id` against `registration_captains`
- Never trust client-side filtering
- Use database joins or EXISTS clauses to enforce scoping
- Audit captain actions in `email_logs` or new `audit_log` table

**Example:**
```typescript
// BAD: Client provides registration list
const registrationIds = req.body.registrationIds  // User could inject any ID
const data = await supabase
  .from('user_registrations')
  .select('*')
  .in('registration_id', registrationIds)

// GOOD: Server determines accessible registrations
const { data: captainships } = await supabase
  .from('registration_captains')
  .select('registration_id')
  .eq('user_id', userId)

const registrationIds = captainships.map(c => c.registration_id)
const data = await supabase
  .from('user_registrations')
  .select('*')
  .in('registration_id', registrationIds)
```

## Design Decisions Made

### 1. Captain as Tab vs Separate Mode ✓ DECIDED

**Decision:** Captain is a tab within `/user`, not a separate top-level route or mode

**Rationale:**
- Captain is a permission/feature, not a role level like admin
- Solves admin/captain overlap naturally - admins can use the Captain tab
- No mode switching confusion - just click the tab you need
- Consistent with existing `/user` navigation pattern
- Simpler implementation - no toggle logic needed
- Graceful degradation - non-captains see empty state

**Implementation:**
- URLs: `/user/captain/*` (nested under user routes)
- Navigation: Show "Captain" tab only if user has captain assignments
- Admins who are also captains can use the Captain tab OR admin pages (their choice)

### 2. Captain Self-Assignment ✓ DECIDED

**Decision:** No. Only admins should assign captains.

**Rationale:**
- Prevents captain "wars" (removing each other)
- Prevents captains adding themselves to other teams
- Clear authority structure
- Reduces security complexity

**Implementation:** Captain assignment UI only in admin pages

### 3. Registration Type Restrictions ✓ DECIDED

**Decision:** Allow all types (teams, scrimmages, events) initially.

**Rationale:**
- Captains may lead scrimmage teams or event groups
- More flexible and future-proof
- Database schema already supports this (no type restriction)
- Easy to restrict later if needed

**Implementation:** No type filtering in queries. If restriction needed later, can add `allowed_types` column to `registration_captains`

### 4. Historical Data

**Question:** What happens to captain access when registration ends?

**Recommendation:**
- Captains maintain read-only access to past registrations
- Can still view roster and alternates
- Cannot create new alternate requests for past registrations (already enforced by registration end date)

### 5. Payment Information Visibility ✓ DECIDED

**Decision:** Show payment status (Paid, Pending, Failed, Refunded) but NOT actual dollar amounts.

**Rationale:**
- Captains need to know if team is fully paid for planning purposes
- Don't need to see specific dollar amounts (privacy)
- Admin reports already show amounts, captains get simplified view
- Refunded members should be visible but greyed out (removed from active roster)

**UI:**
```
Member Payment Status Summary:
✓ Paid: 12 members
⏳ Pending: 2 members
✗ Failed: 1 member
↩ Refunded: 1 member (greyed out in roster)
```

### 6. Captain Notifications - Granularity ✓ DECIDED

**Decision:** Per-registration (not global)

**Rationale:**
- Captain may want notifications for competitive team but not casual scrimmage
- More flexible user experience
- Easy to add "enable all" toggle later
- Already supported by schema (notification setting in `registration_captains` table)

**Implementation:** Each captain-registration relationship has its own `email_notifications` boolean

### 7. Waitlist Visibility ✓ DECIDED

**Decision:** Yes, captains can see waitlisted members (read-only)

**Rationale:**
- Helps captains plan (know if spots will fill)
- Cannot move users from waitlist to roster (admin-only function)
- Same data shown on roster page with "Waitlist" badge/section

**Implementation:** Include waitlist data in roster API response, display in separate section

## Technical Notes

### Database Migration

```sql
-- Migration: Add email notifications to registration_captains
-- File: supabase/migrations/YYYYMMDD_add_captain_email_notifications.sql

ALTER TABLE registration_captains
ADD COLUMN email_notifications BOOLEAN DEFAULT FALSE;

-- Index for efficient notification queries
CREATE INDEX idx_registration_captains_notifications
ON registration_captains(registration_id, email_notifications)
WHERE email_notifications = TRUE;

-- Comments
COMMENT ON COLUMN registration_captains.email_notifications IS
'Whether captain wants email notifications when members register for this team';
```

### Environment Variables

Add to `.env.local` and Vercel:
```bash
# Captain email notification templates
LOOPS_CAPTAIN_REGISTRATION_NOTIFICATION_TEMPLATE_ID=tmpl_xxx  # When member registers for team
LOOPS_CAPTAIN_ASSIGNMENT_NOTIFICATION_TEMPLATE_ID=tmpl_yyy    # When captain is assigned
LOOPS_CAPTAIN_REMOVAL_NOTIFICATION_TEMPLATE_ID=tmpl_zzz       # When captain is removed
```

### Type Definitions

```typescript
// src/types/captain.ts

export interface CaptainRegistration {
  id: string
  name: string
  type: 'team' | 'scrimmage' | 'event'
  season: {
    id: string
    name: string
  }
  memberCount: number
  alternateCount?: number
  emailNotifications: boolean  // Captain's notification preference for this reg
}

export interface CaptainAccess {
  userId: string
  registrationId: string
  emailNotifications: boolean
  assignedAt: string
  assignedBy?: string
}

export interface RosterMember {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  memberId: string
  paymentStatus: 'paid' | 'awaiting_payment' | 'processing' | 'failed'
  registrationDate: string
  isWaitlisted: boolean
  attributes: {
    isLgbtq?: boolean
    isGoalie?: boolean
  }
}
```

## Testing Checklist

### Manual Testing

**Captain Access:**
- [ ] Non-captain cannot access `/captain` routes (redirected to `/user`)
- [ ] Captain sees only their assigned registrations
- [ ] Captain cannot access `/captain/[id]` for registration they don't captain
- [ ] Captain can access roster for their teams
- [ ] Captain can manage alternates for their teams only

**Admin Features:**
- [ ] Admin can assign user as captain
- [ ] Admin can remove captain
- [ ] Admin can toggle captain email notifications
- [ ] Captain receives assignment notification email

**Email Notifications:**
- [ ] Captain with notifications ON receives email when member registers
- [ ] Captain with notifications OFF does not receive email
- [ ] Email contains correct member and registration details
- [ ] Email link to roster works
- [ ] Multiple captains all receive notification

**Role Switching:**
- [ ] Member-only users: No toggle shown
- [ ] Captain-only users: Member/Captain toggle works
- [ ] Admin-only users: Member/Admin toggle works (no captain mode)
- [ ] Toggle persists across page navigation
- [ ] Correct navigation items shown per mode

**Edge Cases:**
- [ ] Captain assigned to multiple teams sees all in dashboard
- [ ] Captain removed from team loses access immediately
- [ ] Registration with no captains: no emails sent
- [ ] Past registration: captain has read-only access

### Automated Testing

**API Tests:**
```typescript
// src/app/api/captain/registrations/route.test.ts
describe('GET /api/captain/registrations', () => {
  it('returns only registrations where user is captain', async () => {
    // Arrange: Create user, registrations, assign as captain
    // Act: Call API
    // Assert: Returns only captain registrations
  })

  it('returns 401 for unauthenticated users', async () => {
    // Test unauthorized access
  })

  it('returns empty array for non-captains', async () => {
    // Test user with no captain assignments
  })
})
```

**Component Tests:**
```typescript
// src/components/captain/CaptainDashboard.test.tsx
describe('CaptainDashboard', () => {
  it('displays registration tiles', async () => {
    // Test rendering with mock data
  })

  it('shows empty state when no registrations', async () => {
    // Test zero state
  })
})
```

## Success Metrics

**Adoption:**
- Number of registrations with assigned captains
- Number of active captains (logged in to captain pages)
- Captain actions per week (roster views, alternate selections)

**Engagement:**
- Email notification opt-in rate
- Average time spent on captain pages
- Frequency of alternate management by captains vs admins

**Efficiency:**
- Reduction in admin time managing alternates (shifted to captains)
- Faster alternate selection response times

## Future Enhancements

**Post-MVP ideas (not in scope for initial release):**

1. **Captain-to-team communication**
   - Send announcements/emails to team members
   - Team chat or discussion board

2. **Captain analytics**
   - Registration trends over time
   - Attendance tracking (if game results added)
   - Member engagement scores

3. **Captain onboarding**
   - Welcome tour of captain features
   - Best practices guide
   - Video tutorials

4. **Bulk operations**
   - Export roster to Excel
   - Print-friendly roster view
   - Bulk alternate selection

5. **Mobile app**
   - Native mobile app for captains
   - Push notifications for new registrations
   - Quick alternate selection on the go

6. **Team customization**
   - Captain can set team logo/colors
   - Custom fields per registration
   - Team motto or description

7. **Delegation**
   - Captain can assign "assistant captains" with limited permissions
   - Co-captain role (equals)

8. **Integration with scheduling**
   - If game scheduling added, captains manage their team's schedule
   - Mark member availability
   - RSVP tracking

## Related Documentation

- [Alternate Registration System](.kiro/specs/alternate-registration-system/)
- [Database Architecture](./docs/architecture/database.md)
- [Email Architecture](./docs/architecture/email-architecture.md)

## Approval & Sign-off

**✓ Design Decisions Approved:**
1. ✓ Captain as tab within `/user` (not separate mode or top-level route)
2. ✓ URL structure: `/user/captain/[id]/roster` and `/user/captain/[id]/alternates` (nested)
3. ✓ Payment info visibility: Show status badges (Paid, Pending, Failed, Refunded), not amounts
4. ✓ Registration type scope: Allow all types (teams, scrimmages, events)
5. ✓ Captain management: Integrated into `/admin/registrations/[id]` page
6. ✓ Show captains on registration tiles in reports
7. ✓ Admin/captain overlap solved naturally - admins can use Captain tab

**Ready to implement after:**
- [ ] This planning document reviewed and approved
- [ ] UI mockups created for:
  - [ ] Captain dashboard (`/user/captain`)
  - [ ] Captain roster view (`/user/captain/[id]/roster`)
  - [ ] Captain tab in user navigation
  - [ ] Captain section in admin registration detail
  - [ ] Captain display on registration tiles
- [ ] Loops email templates created:
  - [ ] Captain assignment notification
  - [ ] Captain registration notification
  - [ ] Captain removal notification
- [ ] Security approach confirmed (RLS policies, API validation)

---

**Next Steps:**
1. Create UI mockups for review
2. Once mockups approved, create Loops templates
3. Move this document to `docs/features/approved/`
4. Begin Phase 1 implementation
