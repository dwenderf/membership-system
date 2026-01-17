# Captain Access Feature

## Overview

This feature will add captain-level access to the membership system, allowing designated captains to manage their own teams, view registrations, manage alternates, and optionally receive email notifications when members register for their teams.

**Status:** Planning
**Created:** 2026-01-17
**Priority:** Medium

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

**Recommendation: Use `/captain` base URL**

**Pros:**
- Clear separation of concerns
- Easier to secure via middleware
- Follows existing `/admin` pattern
- URL structure clearly indicates permission level
- Future-proof for adding captain-specific features

**Cons:**
- Some code duplication from admin pages
- More files to maintain

**Proposed URL Structure:**
```
/captain                              # Captain dashboard (shows all teams they captain)
/captain/[registrationId]             # Team detail page
/captain/[registrationId]/alternates  # Manage alternates for team
/captain/[registrationId]/roster      # View registered members
```

**API Routes:**
```
/api/captain/registrations            # Get all registrations user captains
/api/captain/[registrationId]/roster  # Get roster for specific team
/api/captain/[registrationId]/alternates  # Manage alternates
```

**Admin Routes for Captain Management:**
```
/admin/registrations/[id]/captains    # Assign/remove captains
/api/admin/registrations/[id]/captains  # API for captain management
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

### 4. Role Switching

**Recommendation: Three-mode toggle (Member / Captain / Admin)**

**Implementation:**
```
Member Mode:  /user/*
Captain Mode: /captain/*
Admin Mode:   /admin/* (admins only)
```

**Toggle Logic:**
```typescript
interface UserRoles {
  isMember: boolean      // Everyone
  isCaptain: boolean     // Has entries in registration_captains
  isAdmin: boolean       // users.is_admin = true
}

// Toggle component shows:
// - Member-only users: No toggle (always in member mode)
// - Captains only: "Member" / "Captain" toggle
// - Admins only: "Member" / "Admin" toggle
// - Captain + Admin: "Member" / "Captain" / "Admin" toggle
```

**Question for clarification:**
Should admins have access to captain pages if they're also captains? Or should admins only use admin pages (which show everything)?

**Proposed approach:**
- If user is admin, hide captain mode even if they're assigned as captain
- Admins use admin pages which already show all teams
- Simpler toggle: Member/Admin for admins, Member/Captain for captains
- Prevents confusion about which mode to use

## Detailed Requirements

### 1. Captain Dashboard (`/captain`)

**Features:**
- Display all registrations where user is a captain
- Show registration tiles similar to `/admin/reports/registrations`
- Each tile shows:
  - Registration name and type (Team, Scrimmage, Event)
  - Season
  - Number of registered members
  - Number of alternates (if enabled)
  - Quick actions: View Roster, Manage Alternates

**API Endpoint:**
```typescript
// GET /api/captain/registrations
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

### 2. Team Roster Page (`/captain/[registrationId]/roster`)

**Features:**
- View all registered members for the team (similar to `/admin/reports/registrations/[id]`)
- Display member information:
  - Name, email, phone
  - Member ID
  - Payment status
  - Registration date
  - User attributes (LGBTQ, Goalie, etc.)
- Sortable and searchable table
- Export to CSV (optional, for future)

**Permissions:**
- Can view: Members who registered for captain's team
- Cannot: Edit registrations, process refunds, view payment details

**API Endpoint:**
```typescript
// GET /api/captain/[registrationId]/roster
// Validates captain access before returning data
```

### 3. Alternates Management (`/captain/[registrationId]/alternates`)

**Features:**
- Reuse existing `AlternatesManager` component
- Show only registrations the user captains (filtered)
- Full alternate functionality:
  - Create alternate requests for specific games/dates
  - View members who opted into alternates
  - Select alternates for games
  - Send notifications to selected alternates

**Permissions:**
- Captains can only create/manage alternates for their assigned registrations
- RLS policies already enforce this at database level

**API Endpoints:**
```typescript
// GET /api/captain/[registrationId]/alternates
// POST /api/captain/[registrationId]/alternates/games
// POST /api/captain/[registrationId]/alternates/[gameId]/select
```

**Scoping:**
When captain opens `/captain/alternates`, they see:
- Only their registrations in the dropdown filter
- Cannot select other registrations
- Simpler UX than admin view (which shows all)

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
  viewRosterUrl: string        // "https://my.nycpha.org/captain/abc-123/roster"
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

**Admin UI:** `/admin/registrations/[id]/captains`

**Features:**
- Tab or section in registration detail page
- List current captains with:
  - Name, email, member ID
  - Date assigned
  - Assigned by (admin name)
  - Email notification status (on/off)
  - [Remove] button
- Add captain:
  - Search for user by name, email, or member ID
  - Select user
  - Toggle "Enable email notifications" (default: off)
  - [Add Captain] button

**API Endpoints:**
```typescript
// GET /api/admin/registrations/[id]/captains
// POST /api/admin/registrations/[id]/captains
// DELETE /api/admin/registrations/[id]/captains/[userId]
// PATCH /api/admin/registrations/[id]/captains/[userId]  // Update notification settings
```

**Database Changes Needed:**
```sql
-- Add column for email notification preference
ALTER TABLE registration_captains
ADD COLUMN email_notifications BOOLEAN DEFAULT FALSE;
```

**New email template for captain assignment:**
```
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

## Implementation Phases

### Phase 1: Foundation (MVP)
**Goal:** Core captain access with roster viewing

- [ ] Add `email_notifications` column to `registration_captains` table
- [ ] Create captain middleware for route protection
- [ ] Build `/captain` dashboard page
  - [ ] API: GET `/api/captain/registrations`
  - [ ] UI: Captain dashboard with registration tiles
- [ ] Build `/captain/[registrationId]` detail page
  - [ ] API: GET `/api/captain/[registrationId]/roster`
  - [ ] UI: Roster table (reuse admin component)
- [ ] Add captain/member toggle to navigation
  - [ ] Update `UserNavigation` to detect captain status
  - [ ] Add toggle UI component
- [ ] Admin: Captain assignment UI
  - [ ] Page: `/admin/registrations/[id]/captains`
  - [ ] API: Captain CRUD endpoints
  - [ ] UI: List captains, add/remove

**Testing:**
- Assign captain to registration
- Captain logs in, sees team in dashboard
- Captain views roster, sees only their team's members
- Non-captains cannot access `/captain` routes

### Phase 2: Alternates Management
**Goal:** Captains can manage alternates for their teams

- [ ] Build `/captain/[registrationId]/alternates` page
  - [ ] Reuse `AlternatesManager` component with captain scope
  - [ ] Filter to only show captain's registrations
- [ ] Create captain-scoped alternate APIs
  - [ ] GET `/api/captain/[registrationId]/alternates`
  - [ ] POST `/api/captain/[registrationId]/alternates/games`
  - [ ] POST `/api/captain/[registrationId]/alternates/select`
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
- [ ] Build `/captain/settings` page
  - [ ] List all registrations user captains
  - [ ] Toggle email notifications per registration
  - [ ] API: PATCH `/api/captain/settings/notifications`

### Phase 4: Polish & Additional Features
**Goal:** Improved UX and admin features

- [ ] Captain assignment notification email
  - [ ] New Loops template
  - [ ] Send when captain is added
- [ ] Export roster to CSV (captain page)
- [ ] Mobile-responsive captain pages
- [ ] Analytics/metrics for captain dashboard
  - [ ] Registrations over time
  - [ ] Alternate usage stats
- [ ] Audit logging for captain actions
- [ ] Captain removal notification email

## Security Considerations

### Authentication & Authorization

**Middleware Checks:**
```typescript
// src/middleware.ts
if (pathname.startsWith('/captain')) {
  // 1. Check user is authenticated
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirectToLogin()

  // 2. Check user is a captain of at least one registration
  const { data: captainships } = await supabase
    .from('registration_captains')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)

  if (!captainships?.length) {
    return NextResponse.redirect('/user')  // Not a captain
  }
}
```

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

## Open Questions & Decisions Needed

### 1. Admin/Captain Role Overlap

**Question:** If a user is both an admin and a captain, how should the toggle work?

**Option A:** Show all three modes (Member / Captain / Admin)
- Pros: Maximum flexibility
- Cons: More complex UI, potential confusion

**Option B:** Hide captain mode for admins (admins use admin pages only)
- Pros: Simpler, admins already see everything
- Cons: Can't "test" captain experience

**Option C:** Show captain mode for admins, but as a separate link (not in toggle)
- Pros: Admins can test captain features, clear primary mode
- Cons: Slightly more complex

**Recommendation:** Option B for simplicity. Admins who want to test captain features can temporarily remove their admin access.

### 2. Captain Self-Assignment

**Question:** Should captains be able to assign other captains to their teams?

**Recommendation:** No. Only admins should assign captains. This prevents:
- Captain "wars" (removing each other)
- Captains adding themselves to other teams
- Confusion about authority

### 3. Registration Type Restrictions

**Question:** Should we restrict captains to only team registrations, or allow scrimmages/events?

**Recommendation:** Allow all types initially. Easy to restrict later if needed.

**Implementation:** No type filtering in queries. If restriction needed later:
```sql
ALTER TABLE registration_captains
ADD COLUMN allowed_types TEXT[] DEFAULT ARRAY['team', 'scrimmage', 'event'];
```

### 4. Historical Data

**Question:** What happens to captain access when registration ends?

**Recommendation:**
- Captains maintain read-only access to past registrations
- Can still view roster and alternates
- Cannot create new alternate requests for past registrations (already enforced by registration end date)

### 5. Payment Information Visibility

**Question:** Should captains see payment status and amounts?

**Current Recommendation:** Yes, show payment status (Paid, Pending, Failed) but NOT actual amounts.

**Rationale:**
- Captains need to know if team is fully paid for planning purposes
- Don't need to see specific dollar amounts (privacy)
- Admin reports already show amounts, captains get simplified view

**UI:**
```
Member Payment Status:
✓ Paid: 12 members
⏳ Pending: 2 members
✗ Failed: 1 member
```

### 6. Captain Notifications - Granularity

**Question:** Should notification settings be per-registration or global?

**Recommendation:** Per-registration (already in schema as FK to registration_id)

**Rationale:**
- Captain may want notifications for competitive team but not casual scrimmage
- More flexible
- Easy to add "enable all" toggle later

### 7. Waitlist Visibility

**Question:** Should captains see waitlisted members?

**Recommendation:** Yes, read-only.

**Rationale:**
- Helps captains plan (know if spots will fill)
- Cannot move users from waitlist (admin function)
- Same data shown on roster page with "Waitlist" badge

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
LOOPS_CAPTAIN_REGISTRATION_NOTIFICATION_TEMPLATE_ID=tmpl_xxx
LOOPS_CAPTAIN_ASSIGNMENT_NOTIFICATION_TEMPLATE_ID=tmpl_yyy
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

**Decision needed on:**
1. Admin/captain role overlap (recommendation: Option B - hide captain mode for admins)
2. Payment info visibility (recommendation: show status, not amounts)
3. Confirm registration type scope (recommendation: allow all types)

**Ready to implement after:**
- [ ] Design decisions approved
- [ ] Loops templates created
- [ ] UI mockups reviewed (optional, but recommended for dashboard)
- [ ] Security approach confirmed

---

**Next Steps:**
Once this plan is approved, move this document to `docs/features/approved/` and begin Phase 1 implementation.
