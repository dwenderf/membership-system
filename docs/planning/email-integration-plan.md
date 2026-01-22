# Email Integration Plan - Non-Transactional Email System

**Date:** 2026-01-22
**Status:** Planning Phase
**Current Integration:** Loops.so (Active - Transactional Only)
**Goal:** Add non-transactional email capabilities with subscription management and admin broadcast system

---

## Executive Summary

This plan outlines the implementation of a comprehensive non-transactional email system for the membership platform. Currently, the system sends only transactional emails (purchase confirmations, payment notifications, etc.). This enhancement will add:

1. **Non-transactional email categories** - Announcements, event notifications, captain alerts
2. **User subscription management** - Granular opt-in/opt-out controls with global unsubscribe
3. **Automated triggered emails** - Event-based notifications (e.g., captain alerts on team registrations)
4. **Admin broadcast system** - Compose, schedule, and send targeted campaigns with markdown support
5. **Campaign analytics** - Track delivery, opens, and engagement metrics

---

## Current State Analysis

### ✅ What's Already Built

#### 1. **Core Email Infrastructure**
- **Loops Client Integration**: Fully configured with API key support
- **Email Service Layer**: Centralized `EmailService` class with 11+ transactional email methods
- **Staging System**: Database-backed email queue (`email_logs` table)
- **Batch Processing**: Cron-based email processor running every minute
- **Deduplication**: Prevents duplicate emails for same payment/action
- **Error Handling**: Graceful degradation when Loops unavailable

#### 2. **Implemented Email Types** (11 Types)

**Payment & Purchase**
- ✅ Membership purchase confirmation
- ✅ Registration confirmation
- ✅ Waitlist added notification
- ✅ Waitlist selection confirmation
- ✅ Refund processed notification
- ✅ Payment failed alert

**Payment Plans**
- ✅ Pre-notification (3 days before installment)
- ✅ Payment processed confirmation
- ✅ Payment failed alert
- ✅ Payment plan completed

**Account Management**
- ✅ Welcome email
- ✅ Account deletion confirmation

**Admin Actions**
- ✅ Captain assignment notification
- ✅ Captain removal notification
- ✅ Payment method removed

#### 3. **Architecture Highlights**

```
User Action → Email Processor → Staging (DB) → Cron Job → Loops API → User Inbox
```

**Key Features:**
- Non-blocking email sending via staging
- Full audit trail in `email_logs` table
- Retry logic for failed emails
- Template-based and event-based sending
- Comprehensive metadata tracking (Loops event IDs, bounce reasons, delivery status)

---

## Requirements

### 1. **Email Classification System**

All emails must be classified into two categories:

#### **Transactional Emails** (Cannot Unsubscribe)
These are critical, action-based emails that users cannot opt out of:
- ✅ Membership purchase confirmation
- ✅ Registration confirmation
- ✅ Payment success/failure notifications
- ✅ Refund notifications
- ✅ Payment plan notifications
- ✅ Account deletion confirmation
- ✅ Welcome email
- ✅ Waitlist confirmations

#### **Non-Transactional Emails** (Can Unsubscribe) - **NEW**
Users can opt out of these marketing/informational emails:
- ❌ **New Features/Updates** - Announce new website features and improvements
- ❌ **Upcoming Events** - Notify about upcoming registrations, events, scrimmages, tournaments
- ❌ **Membership Expiration Warnings** - Remind users before membership expires
- ❌ **Captain/Admin Notifications** - Alert captains when someone joins their team
- ❌ **Financial Updates** - Notify admins/captains about payment-related events
- ❌ **General Announcements** - Broadcast messages from administrators

### 2. **Subscription Management Requirements**

#### **User Preferences System**
Users must be able to control their email preferences with:

1. **Global Unsubscribe Toggle**
   - Master switch to opt out of ALL non-transactional emails
   - Accessible via unsubscribe link in emails
   - Can be re-enabled in user settings

2. **Granular Category Controls** (Only if not globally unsubscribed)
   - ☐ Captain notifications (for users who are captains)
   - ☐ Upcoming events and registrations
   - ☐ General announcements and updates
   - ☐ Membership-related notifications
   - ☐ Feature announcements

3. **Business Rules**
   - If globally unsubscribed → all category checkboxes disabled
   - Must re-enable global subscription to access category controls
   - Transactional emails always sent regardless of preferences

#### **Unsubscribe Flow**
1. User clicks "Unsubscribe" link in email
2. Redirected to preferences page showing current settings
3. Can choose: global unsubscribe OR disable specific categories
4. Confirmation message displayed
5. Change takes effect immediately

### 3. **Automated/Triggered Email Requirements**

These emails send automatically based on application events:

| Trigger Event | Recipients | Email Type | Category |
|--------------|-----------|------------|----------|
| User registers for team | Team captain(s) | Captain notification | Captain Emails |
| New registration opens | All members (or filtered) | Event announcement | Upcoming Events |
| Membership expires in 7/3/1 days | Member | Expiration warning | Membership Notifications |
| Payment failed (admin alert) | Admins | Financial alert | Admin Notifications |
| New feature released | All users | Feature announcement | Feature Announcements |

**Technical Requirements:**
- Use existing email staging system (`email_logs` table)
- Check user preferences before staging
- Log all attempts (including skipped due to preferences)
- Process via existing cron job (every minute)

### 4. **Admin Broadcast System Requirements**

Administrators need capability to compose and send targeted email campaigns.

#### **Campaign Composer Interface**

**Must include:**
1. **Email Content**
   - Subject line input
   - Markdown editor for body content
   - Real-time preview pane (markdown → HTML)
   - Support for common formatting: headers, bold, italic, lists, links, images

2. **Recipient Filtering**
   - Filter by membership type (active, expired, none)
   - Filter by registration status (registered for specific events)
   - Filter by user role (captain, admin, regular user)
   - Filter by subscription preferences (only send to opted-in users)
   - **Real-time recipient count display**
   - **Expandable recipient list preview** (show names/emails)

3. **Scheduling Options**
   - Send now (queues for next cron job run ~1 minute)
   - Schedule for specific date/time
   - Save as draft for later

4. **Email Category Selection**
   - Choose which subscription category this broadcast belongs to
   - System automatically filters recipients based on preferences

#### **Campaign Management Interface**

Admins need a dashboard to view all campaigns:

**Table/List View showing:**
- Campaign name/subject
- Status (draft, scheduled, sending, sent)
- Scheduled send time
- Actual sent time
- Total recipients
- Emails sent count
- Delivery rate (if available from Loops)
- Open rate (if available from Loops)
- Created by (admin name)
- Created date

**Actions:**
- View campaign details
- Edit draft campaigns
- Cancel scheduled campaigns
- Duplicate campaign
- View recipient list
- Export campaign analytics

### 5. **Data Model Requirements**

#### **New Tables Needed**

**`email_preferences` table:**
```sql
CREATE TABLE email_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    globally_unsubscribed BOOLEAN DEFAULT FALSE,

    -- Category preferences (only apply if globally_unsubscribed = false)
    captain_emails BOOLEAN DEFAULT TRUE,
    upcoming_events BOOLEAN DEFAULT TRUE,
    general_announcements BOOLEAN DEFAULT TRUE,
    membership_notifications BOOLEAN DEFAULT TRUE,
    feature_announcements BOOLEAN DEFAULT TRUE,

    -- Audit fields
    updated_at TIMESTAMP DEFAULT NOW(),
    unsubscribed_at TIMESTAMP,

    CONSTRAINT check_global_override CHECK (
        globally_unsubscribed = FALSE OR
        (captain_emails = FALSE AND upcoming_events = FALSE AND
         general_announcements = FALSE AND membership_notifications = FALSE AND
         feature_announcements = FALSE)
    )
);
```

**`email_campaigns` table:**
```sql
CREATE TABLE email_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    body_html TEXT, -- Generated from markdown

    -- Categorization
    email_category TEXT NOT NULL, -- 'captain_emails', 'upcoming_events', etc.

    -- Recipient filtering
    filter_config JSONB NOT NULL, -- Stores filter criteria
    recipient_count INTEGER, -- Calculated count
    recipient_list JSONB, -- Array of user IDs (for audit)

    -- Scheduling
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'scheduled', 'processing', 'sent', 'cancelled'
    scheduled_for TIMESTAMP,
    started_sending_at TIMESTAMP,
    completed_sending_at TIMESTAMP,

    -- Creator tracking
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Analytics (populated from email_logs)
    total_staged INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_bounced INTEGER DEFAULT 0
);
```

**Updates to `email_logs` table:**
```sql
ALTER TABLE email_logs
    ADD COLUMN campaign_id UUID REFERENCES email_campaigns(id),
    ADD COLUMN email_category TEXT, -- Links to subscription category
    ADD COLUMN skipped_reason TEXT; -- e.g., 'user_unsubscribed', 'category_disabled'
```

### 6. **Technical Architecture Requirements**

#### **Email Flow for Broadcasts**

```
Admin Composes Campaign → Save to DB (draft)
                ↓
Admin Clicks "Schedule/Send" → Update status to 'scheduled'
                ↓
Cron Job (/api/cron/email-campaigns) → Check for due campaigns
                ↓
For each due campaign:
  1. Query recipients based on filter_config
  2. Filter out unsubscribed/opted-out users
  3. Stage emails to email_logs with campaign_id
  4. Update campaign status to 'processing'
                ↓
Existing Email Cron (/api/cron/email-sync) → Process staged emails
                ↓
Loops API → Send emails
                ↓
Update email_logs with delivery status
                ↓
Aggregate stats back to email_campaigns table
```

#### **Markdown Processing**
- Use library like `marked` or `remark` to convert markdown → HTML
- Sanitize HTML to prevent XSS attacks
- Apply consistent email-friendly CSS styles
- Support for:
  - Headers (H1-H6)
  - Bold, italic, strikethrough
  - Ordered and unordered lists
  - Links (with tracking if needed)
  - Images (external URLs)
  - Code blocks (inline and fenced)
  - Blockquotes

#### **Preference Checking Logic**
Before staging ANY non-transactional email:
```typescript
async function canSendEmail(userId: string, emailCategory: string): Promise<boolean> {
  const prefs = await getEmailPreferences(userId);

  // Check global unsubscribe
  if (prefs.globally_unsubscribed) {
    return false;
  }

  // Check category-specific preference
  const categoryField = emailCategory; // e.g., 'captain_emails'
  if (prefs[categoryField] === false) {
    return false;
  }

  return true;
}
```

### 7. **Loops Integration Requirements**

#### **Template Strategy**
For broadcast emails, we have two options:

**Option A: Dynamic Template (Recommended)**
- Create single Loops template for "Campaign Broadcast"
- Pass subject and HTML body as variables
- Template structure:
  ```
  Subject: {{subject}}
  Body: {{{htmlBody}}} (triple braces for unescaped HTML)
  Footer: Standard unsubscribe link + branding
  ```

**Option B: API-Only Sending**
- Use Loops `sendTransactionalEmail` with full HTML body
- More flexibility but less tracking in Loops UI

**Recommendation:** Use Option A for better integration with Loops analytics

#### **Unsubscribe Link Handling**
Each non-transactional email must include:
```html
<a href="{{unsubscribeUrl}}">Unsubscribe from these emails</a>
```

Where `unsubscribeUrl` = `https://yoursite.com/settings/email-preferences?token={encrypted_user_token}`

---

## Implementation Roadmap

### Phase 1: Foundation - Subscription Management (Week 1-2)

**Goal:** Build the preference system and unsubscribe infrastructure

#### 1.1 Database Schema
- [ ] Create `email_preferences` table with migration
- [ ] Add columns to `email_logs`: `campaign_id`, `email_category`, `skipped_reason`
- [ ] Create `email_campaigns` table with migration
- [ ] Add indexes for performance

**Migration file:** `supabase/migrations/YYYYMMDD_add_email_preferences.sql`

**Estimated effort:** 4 hours

---

#### 1.2 Preference Management Service
- [ ] Create `src/lib/email/preferences.ts` service
- [ ] Implement `getEmailPreferences(userId)`
- [ ] Implement `updateEmailPreferences(userId, prefs)`
- [ ] Implement `globalUnsubscribe(userId)`
- [ ] Implement `canSendEmail(userId, category)` permission checker
- [ ] Add default preferences on user creation

**Files to create:**
- `src/lib/email/preferences.ts`
- `src/lib/email/categories.ts` (email category constants)

**Estimated effort:** 6 hours

---

#### 1.3 User Preferences UI
- [ ] Create `/settings/email-preferences` page
- [ ] Display current preference settings
- [ ] Implement global unsubscribe toggle
- [ ] Implement category checkboxes (disabled when globally unsubscribed)
- [ ] Show last updated timestamp
- [ ] Add confirmation messages
- [ ] Handle unsubscribe token from email links

**Files to create:**
- `src/app/settings/email-preferences/page.tsx`
- `src/components/email-preferences/PreferenceToggle.tsx`

**API routes:**
- `src/app/api/email-preferences/route.ts` (GET/POST)
- `src/app/api/unsubscribe/route.ts` (handle email unsubscribe links)

**Estimated effort:** 8 hours

---

#### 1.4 Update Existing Email Service
- [ ] Categorize all existing emails as transactional
- [ ] Add `emailCategory` parameter to email methods
- [ ] Integrate preference checking for non-transactional emails
- [ ] Add unsubscribe link to email template footer
- [ ] Generate secure unsubscribe tokens

**Files to modify:**
- `src/lib/email/service.ts`
- `src/lib/email/constants.ts` (add EMAIL_CATEGORIES)

**Estimated effort:** 4 hours

**Phase 1 Total:** ~22 hours

---

### Phase 2: Automated Non-Transactional Emails (Week 2-3)

**Goal:** Implement automated triggered emails with subscription checks

#### 2.1 Membership Expiration Warnings
- [ ] Create Loops templates (7-day, 3-day, 1-day warnings)
- [ ] Implement `sendMembershipExpirationWarning()` in EmailService
- [ ] Update `/api/cron/membership-expiration-check` to stage emails
- [ ] Add preference check (category: `membership_notifications`)
- [ ] Test with sample expiring memberships

**Files to modify:**
- `src/lib/email/service.ts`
- `src/app/api/cron/membership-expiration-check/route.ts`

**Loops templates to create:** 3 templates

**Estimated effort:** 6 hours

---

#### 2.2 Captain Notifications
- [ ] Create Loops template for team registration notification
- [ ] Implement `sendCaptainTeamRegistrationNotification()`
- [ ] Trigger on registration completion in `PaymentCompletionProcessor`
- [ ] Add preference check (category: `captain_emails`)
- [ ] Include registration details, member info, team roster link

**Files to create:**
- `src/lib/email/captain-notifications.ts`

**Files to modify:**
- `src/lib/payment-completion-processor.ts`
- `src/lib/email/service.ts`

**Loops templates to create:** 1 template

**Estimated effort:** 8 hours

---

#### 2.3 Upcoming Event Notifications
- [ ] Create Loops template for event announcements
- [ ] Create cron job `/api/cron/event-announcements`
- [ ] Implement logic to announce new registrations opening
- [ ] Add preference check (category: `upcoming_events`)
- [ ] Support filtering by membership status (members only vs all)

**Files to create:**
- `src/app/api/cron/event-announcements/route.ts`
- `src/lib/email/event-notifications.ts`

**Loops templates to create:** 1 template

**Estimated effort:** 6 hours

**Phase 2 Total:** ~20 hours

---

### Phase 3: Admin Broadcast System - Backend (Week 3-4)

**Goal:** Build campaign creation, scheduling, and processing infrastructure

#### 3.1 Campaign Service Layer
- [ ] Create `src/lib/email/campaigns.ts` service
- [ ] Implement `createCampaign(data)` - save draft
- [ ] Implement `updateCampaign(id, data)` - update draft
- [ ] Implement `scheduleCampaign(id, scheduledFor)` - mark for sending
- [ ] Implement `getCampaign(id)` - retrieve campaign
- [ ] Implement `listCampaigns(filters)` - list with pagination
- [ ] Implement `cancelCampaign(id)` - cancel scheduled
- [ ] Implement `duplicateCampaign(id)` - copy existing

**Files to create:**
- `src/lib/email/campaigns.ts`

**Estimated effort:** 8 hours

---

#### 3.2 Recipient Filtering Engine
- [ ] Create `src/lib/email/campaign-recipients.ts`
- [ ] Implement `buildRecipientQuery(filterConfig)` - dynamic SQL query builder
- [ ] Support filters:
  - Membership type (active, expired, none, specific types)
  - Registration status (registered for specific events/categories)
  - User role (captain, admin, regular)
  - Email preferences (opted-in to specific categories)
- [ ] Implement `getRecipientCount(filterConfig)` - count matching users
- [ ] Implement `getRecipientList(filterConfig)` - full list with details
- [ ] Add pagination for large lists

**Files to create:**
- `src/lib/email/campaign-recipients.ts`

**Estimated effort:** 10 hours

---

#### 3.3 Markdown Processing
- [ ] Install markdown library (`marked` or `remark`)
- [ ] Install HTML sanitization library (`dompurify` or `sanitize-html`)
- [ ] Create `src/lib/email/markdown.ts`
- [ ] Implement `markdownToHtml(markdown)` converter
- [ ] Apply email-friendly CSS styles
- [ ] Sanitize output to prevent XSS
- [ ] Support images, links, lists, headers, code blocks

**Files to create:**
- `src/lib/email/markdown.ts`

**Estimated effort:** 4 hours

---

#### 3.4 Campaign Processing Cron Job
- [ ] Create `/api/cron/email-campaigns` route
- [ ] Query for campaigns where `status = 'scheduled'` AND `scheduled_for <= NOW()`
- [ ] For each campaign:
  - Get recipient list based on filter_config
  - Filter out users based on preferences
  - Stage emails to `email_logs` with `campaign_id`
  - Update campaign status to 'processing'
  - Update recipient counts
- [ ] Handle errors gracefully
- [ ] Update campaign to 'sent' when complete

**Files to create:**
- `src/app/api/cron/email-campaigns/route.ts`

**Estimated effort:** 8 hours

---

#### 3.5 API Routes for Campaigns
- [ ] `POST /api/admin/campaigns` - create campaign draft
- [ ] `GET /api/admin/campaigns` - list campaigns
- [ ] `GET /api/admin/campaigns/[id]` - get campaign details
- [ ] `PATCH /api/admin/campaigns/[id]` - update campaign
- [ ] `POST /api/admin/campaigns/[id]/schedule` - schedule campaign
- [ ] `POST /api/admin/campaigns/[id]/cancel` - cancel scheduled
- [ ] `POST /api/admin/campaigns/[id]/duplicate` - duplicate campaign
- [ ] `POST /api/admin/campaigns/preview-recipients` - get recipient count/list
- [ ] `POST /api/admin/campaigns/preview-email` - render markdown preview

**Files to create:**
- `src/app/api/admin/campaigns/route.ts`
- `src/app/api/admin/campaigns/[id]/route.ts`
- `src/app/api/admin/campaigns/[id]/schedule/route.ts`
- `src/app/api/admin/campaigns/[id]/cancel/route.ts`
- `src/app/api/admin/campaigns/[id]/duplicate/route.ts`
- `src/app/api/admin/campaigns/preview-recipients/route.ts`
- `src/app/api/admin/campaigns/preview-email/route.ts`

**Estimated effort:** 12 hours

**Phase 3 Total:** ~42 hours

---

### Phase 4: Admin Broadcast System - Frontend (Week 4-5)

**Goal:** Build admin UI for creating, managing, and monitoring campaigns

#### 4.1 Campaign Composer Page
- [ ] Create `/admin/campaigns/new` page
- [ ] Campaign name input
- [ ] Subject line input
- [ ] Email category selector (dropdown)
- [ ] Markdown editor with toolbar (bold, italic, headers, lists, links, images)
- [ ] Live preview pane (markdown → HTML)
- [ ] Recipient filter builder:
  - Membership type multi-select
  - Registration status filter
  - Role filter
  - Real-time recipient count display
  - "Show Recipients" button → modal with list
- [ ] Scheduling controls:
  - "Save Draft" button
  - "Send Now" button (schedules for next minute)
  - "Schedule for Later" → date/time picker
- [ ] Form validation
- [ ] Auto-save drafts

**Files to create:**
- `src/app/admin/campaigns/new/page.tsx`
- `src/components/campaigns/CampaignComposer.tsx`
- `src/components/campaigns/MarkdownEditor.tsx`
- `src/components/campaigns/EmailPreview.tsx`
- `src/components/campaigns/RecipientFilter.tsx`
- `src/components/campaigns/RecipientList.tsx`

**Estimated effort:** 20 hours

---

#### 4.2 Campaign List & Management Page
- [ ] Create `/admin/campaigns` page
- [ ] Table showing all campaigns with columns:
  - Name/Subject
  - Status (badge with color coding)
  - Category
  - Recipients count
  - Scheduled/Sent time
  - Open rate (if available)
  - Created by
  - Actions (View, Edit, Duplicate, Cancel)
- [ ] Status filters (All, Draft, Scheduled, Sent, Cancelled)
- [ ] Search by name/subject
- [ ] Pagination
- [ ] Sort by date, status, recipients

**Files to create:**
- `src/app/admin/campaigns/page.tsx`
- `src/components/campaigns/CampaignTable.tsx`

**Estimated effort:** 10 hours

---

#### 4.3 Campaign Detail/Analytics Page
- [ ] Create `/admin/campaigns/[id]` page
- [ ] Show campaign details (subject, body, filters used)
- [ ] Display analytics:
  - Total recipients
  - Emails staged
  - Emails sent
  - Delivery rate
  - Open rate (if available from Loops)
  - Click rate (if available from Loops)
  - Bounce rate
- [ ] Timeline of events (created, scheduled, sent)
- [ ] Recipient list table (name, email, status, opened, clicked)
- [ ] Export recipients to CSV
- [ ] "Edit" button (if draft)
- [ ] "Duplicate" button
- [ ] "Cancel" button (if scheduled)

**Files to create:**
- `src/app/admin/campaigns/[id]/page.tsx`
- `src/components/campaigns/CampaignAnalytics.tsx`
- `src/components/campaigns/CampaignTimeline.tsx`

**Estimated effort:** 12 hours

---

#### 4.4 Campaign Analytics Aggregation
- [ ] Create service to aggregate stats from `email_logs` to `email_campaigns`
- [ ] Run as part of email sync cron job
- [ ] Update campaign record with:
  - `total_sent`, `total_delivered`, `total_opened`, `total_clicked`, `total_bounced`
- [ ] Calculate rates for display

**Files to modify:**
- `src/lib/email/batch-sync-email.ts` (add aggregation step)

**Files to create:**
- `src/lib/email/campaign-analytics.ts`

**Estimated effort:** 6 hours

**Phase 4 Total:** ~48 hours

---

### Phase 5: Loops Integration & Testing (Week 5-6)

**Goal:** Set up Loops templates, test end-to-end flows, handle edge cases

#### 5.1 Loops Template Setup
- [ ] Create "Campaign Broadcast" template in Loops dashboard
- [ ] Configure template variables: `subject`, `htmlBody`, `unsubscribeUrl`
- [ ] Test template with sample data
- [ ] Add template ID to environment variables
- [ ] Update EmailService to use new template for campaigns

**Loops template to create:** 1 dynamic template

**Estimated effort:** 3 hours

---

#### 5.2 Unsubscribe Token System
- [ ] Create secure token generation for unsubscribe links
- [ ] Implement `/api/unsubscribe?token=...` endpoint
- [ ] Verify token, decode user ID
- [ ] Show unsubscribe confirmation page
- [ ] Allow resubscribe from same link

**Files to create:**
- `src/lib/email/unsubscribe-tokens.ts`
- `src/app/unsubscribe/page.tsx`

**Estimated effort:** 6 hours

---

#### 5.3 Testing & Quality Assurance
- [ ] Unit tests for preference service
- [ ] Unit tests for campaign service
- [ ] Unit tests for recipient filtering
- [ ] Integration test: full campaign flow
- [ ] Test unsubscribe flow
- [ ] Test preference updates
- [ ] Test markdown rendering with various inputs
- [ ] Test recipient filtering with different criteria
- [ ] Test scheduled campaigns
- [ ] Test cancelling campaigns
- [ ] Load test with large recipient lists (1000+ users)

**Files to create:**
- `tests/email/preferences.test.ts`
- `tests/email/campaigns.test.ts`
- `tests/email/recipients.test.ts`
- `tests/email/markdown.test.ts`

**Estimated effort:** 16 hours

---

#### 5.4 Documentation
- [ ] Document email categories and what they're for
- [ ] Document how to create a campaign (admin guide)
- [ ] Document recipient filtering options
- [ ] Document markdown syntax supported
- [ ] Update Loops template documentation
- [ ] Add troubleshooting guide

**Files to create:**
- `docs/email/admin-guide.md`
- `docs/email/markdown-syntax.md`
- `docs/email/categories.md`

**Estimated effort:** 6 hours

---

#### 5.5 Security & Compliance Review
- [ ] Review for XSS vulnerabilities in markdown rendering
- [ ] Ensure unsubscribe tokens are cryptographically secure
- [ ] Verify permission checks on all admin routes
- [ ] Test SQL injection resistance in recipient filtering
- [ ] Add rate limiting to campaign creation
- [ ] Add audit logging for campaign actions
- [ ] Review CAN-SPAM compliance (unsubscribe required, etc.)

**Estimated effort:** 8 hours

**Phase 5 Total:** ~39 hours

---

### Phase 6: Polish & Launch (Week 6)

**Goal:** Final testing, performance optimization, deployment

#### 6.1 Performance Optimization
- [ ] Add database indexes for campaign queries
- [ ] Optimize recipient filtering queries
- [ ] Implement caching for recipient counts
- [ ] Batch email staging operations (insert 100s at once)
- [ ] Monitor cron job performance

**Estimated effort:** 8 hours

---

#### 6.2 Admin Onboarding
- [ ] Create sample campaign templates
- [ ] Write internal documentation for admins
- [ ] Conduct training session
- [ ] Create video walkthrough

**Estimated effort:** 4 hours

---

#### 6.3 Soft Launch
- [ ] Deploy to production
- [ ] Send test campaign to small group
- [ ] Monitor email delivery rates
- [ ] Check for errors in logs
- [ ] Verify analytics accuracy
- [ ] Gather feedback from admins

**Estimated effort:** 6 hours

---

#### 6.4 Full Launch
- [ ] Announce new email features to users
- [ ] Monitor support tickets for issues
- [ ] Track unsubscribe rates
- [ ] Monitor campaign performance
- [ ] Iterate based on feedback

**Estimated effort:** 4 hours

**Phase 6 Total:** ~22 hours

---

## Summary Timeline & Effort

| Phase | Duration | Effort (hours) | Key Deliverables |
|-------|----------|----------------|------------------|
| Phase 1: Foundation | Week 1-2 | 22 | Subscription management, preferences UI |
| Phase 2: Automated Emails | Week 2-3 | 20 | Membership warnings, captain notifications, event announcements |
| Phase 3: Backend | Week 3-4 | 42 | Campaign service, recipient filtering, cron jobs, API routes |
| Phase 4: Frontend | Week 4-5 | 48 | Campaign composer, management UI, analytics dashboard |
| Phase 5: Integration & Testing | Week 5-6 | 39 | Loops setup, testing, documentation, security review |
| Phase 6: Launch | Week 6 | 22 | Optimization, training, deployment |
| **TOTAL** | **6 weeks** | **193 hours** | **Full non-transactional email system** |

**Note:** These are estimates assuming a single developer working full-time. Adjust based on team size and availability.

---

## Technical Recommendations

### 1. **Email Categories Constants**
Define clear categories as TypeScript constants:

```typescript
// src/lib/email/categories.ts
export const EMAIL_CATEGORIES = {
  // Transactional (cannot unsubscribe)
  TRANSACTIONAL: 'transactional',

  // Non-transactional (can unsubscribe)
  CAPTAIN_EMAILS: 'captain_emails',
  UPCOMING_EVENTS: 'upcoming_events',
  GENERAL_ANNOUNCEMENTS: 'general_announcements',
  MEMBERSHIP_NOTIFICATIONS: 'membership_notifications',
  FEATURE_ANNOUNCEMENTS: 'feature_announcements',
} as const;

export type EmailCategory = typeof EMAIL_CATEGORIES[keyof typeof EMAIL_CATEGORIES];

export const UNSUBSCRIBABLE_CATEGORIES = [
  EMAIL_CATEGORIES.CAPTAIN_EMAILS,
  EMAIL_CATEGORIES.UPCOMING_EVENTS,
  EMAIL_CATEGORIES.GENERAL_ANNOUNCEMENTS,
  EMAIL_CATEGORIES.MEMBERSHIP_NOTIFICATIONS,
  EMAIL_CATEGORIES.FEATURE_ANNOUNCEMENTS,
];

export const CATEGORY_LABELS = {
  [EMAIL_CATEGORIES.CAPTAIN_EMAILS]: 'Team Captain Notifications',
  [EMAIL_CATEGORIES.UPCOMING_EVENTS]: 'Upcoming Events & Registrations',
  [EMAIL_CATEGORIES.GENERAL_ANNOUNCEMENTS]: 'General Announcements',
  [EMAIL_CATEGORIES.MEMBERSHIP_NOTIFICATIONS]: 'Membership Updates',
  [EMAIL_CATEGORIES.FEATURE_ANNOUNCEMENTS]: 'New Features & Updates',
};
```

### 2. **Markdown Library Selection**
**Recommended:** Use `marked` for markdown parsing

```bash
npm install marked
npm install @types/marked --save-dev
npm install dompurify
npm install @types/dompurify --save-dev
```

**Why:**
- Fast, well-maintained
- Supports CommonMark spec
- Easy to configure
- Good TypeScript support

**Alternative:** `remark` (more extensible but heavier)

### 3. **Unsubscribe Token Implementation**
Use JWT or encrypted tokens for secure unsubscribe links:

```typescript
// src/lib/email/unsubscribe-tokens.ts
import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.EMAIL_TOKEN_SECRET);

export async function generateUnsubscribeToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: 'unsubscribe' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(SECRET);
}

export async function verifyUnsubscribeToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload.purpose !== 'unsubscribe') return null;
    return payload.userId as string;
  } catch {
    return null;
  }
}
```

Add to `.env`:
```env
EMAIL_TOKEN_SECRET=<generate_random_32_char_string>
```

### 4. **Database Indexing Strategy**
Critical indexes for performance:

```sql
-- Email preferences lookups
CREATE INDEX idx_email_preferences_user ON email_preferences(user_id);

-- Campaign queries
CREATE INDEX idx_campaigns_status ON email_campaigns(status, scheduled_for);
CREATE INDEX idx_campaigns_created_by ON email_campaigns(created_by, created_at DESC);

-- Email logs campaign analytics
CREATE INDEX idx_email_logs_campaign ON email_logs(campaign_id, status);
CREATE INDEX idx_email_logs_campaign_analytics ON email_logs(campaign_id, status, sent_at)
  WHERE campaign_id IS NOT NULL;

-- Recipient filtering (composite indexes for common filter combinations)
CREATE INDEX idx_users_membership_status ON users(membership_status, membership_type);
CREATE INDEX idx_registrations_event_status ON registrations(event_id, status);
```

### 5. **Recipient Query Builder Pattern**
Use a builder pattern for flexible recipient queries:

```typescript
// src/lib/email/campaign-recipients.ts
export class RecipientQueryBuilder {
  private query: string;
  private params: any[];

  constructor() {
    this.query = 'SELECT DISTINCT u.id, u.email, u.name FROM users u';
    this.params = [];
  }

  withMembershipType(types: string[]) {
    if (types.length > 0) {
      this.query += ` WHERE u.membership_type = ANY($${this.params.length + 1})`;
      this.params.push(types);
    }
    return this;
  }

  withRegistrationStatus(eventId: string) {
    this.query += ` INNER JOIN registrations r ON r.user_id = u.id`;
    this.query += ` WHERE r.event_id = $${this.params.length + 1}`;
    this.params.push(eventId);
    return this;
  }

  withEmailPreference(category: string) {
    this.query += ` INNER JOIN email_preferences ep ON ep.user_id = u.id`;
    this.query += ` WHERE ep.globally_unsubscribed = FALSE`;
    this.query += ` AND ep.${category} = TRUE`;
    return this;
  }

  async execute(): Promise<Recipient[]> {
    const result = await db.query(this.query, this.params);
    return result.rows;
  }
}
```

### 6. **Cron Job Reliability**
Ensure cron jobs handle failures gracefully:

```typescript
// Best practices for campaign cron job
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Wrap in transaction for atomic updates
    await db.transaction(async (tx) => {
      // Lock rows to prevent concurrent processing
      const campaigns = await tx.query(
        `SELECT * FROM email_campaigns
         WHERE status = 'scheduled'
         AND scheduled_for <= NOW()
         FOR UPDATE SKIP LOCKED`
      );

      for (const campaign of campaigns.rows) {
        try {
          await processCampaign(campaign, tx);
        } catch (error) {
          // Log error but continue processing other campaigns
          console.error(`Failed to process campaign ${campaign.id}:`, error);
          await tx.query(
            `UPDATE email_campaigns
             SET status = 'failed', error_message = $1
             WHERE id = $2`,
            [error.message, campaign.id]
          );
        }
      }
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Campaign cron job failed:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

### 7. **Batch Email Staging Optimization**
Stage multiple emails in a single query:

```typescript
// Instead of individual inserts
for (const recipient of recipients) {
  await stageEmail(recipient); // Slow - many DB calls
}

// Use batch insert
const emailRecords = recipients.map(recipient => ({
  user_id: recipient.id,
  email_address: recipient.email,
  campaign_id: campaignId,
  event_type: 'campaign.broadcast',
  status: 'pending',
  // ... other fields
}));

await db.query(
  `INSERT INTO email_logs (user_id, email_address, campaign_id, event_type, status, ...)
   SELECT * FROM json_populate_recordset(NULL::email_logs, $1)`,
  [JSON.stringify(emailRecords)]
);
```

### 8. **Security Best Practices**

#### **Markdown Sanitization**
```typescript
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

export function markdownToSafeHtml(markdown: string): string {
  const html = marked(markdown);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                   'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}
```

#### **Permission Checks**
```typescript
// Middleware for admin-only routes
export async function requireAdmin(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
}

// Use in all campaign routes
export async function POST(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  // ... handle request
}
```

#### **Rate Limiting**
```typescript
// Limit campaign creation to prevent abuse
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 h'), // 10 campaigns per hour
});

export async function POST(request: Request) {
  const session = await getServerSession();
  const { success } = await ratelimit.limit(session.user.id);

  if (!success) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // ... create campaign
}
```

### 9. **Testing Strategy**

#### **Unit Tests**
```typescript
// tests/email/preferences.test.ts
describe('Email Preferences', () => {
  it('should prevent sending when globally unsubscribed', async () => {
    await updateEmailPreferences(userId, { globally_unsubscribed: true });
    const canSend = await canSendEmail(userId, 'upcoming_events');
    expect(canSend).toBe(false);
  });

  it('should allow sending when category enabled', async () => {
    await updateEmailPreferences(userId, {
      globally_unsubscribed: false,
      upcoming_events: true
    });
    const canSend = await canSendEmail(userId, 'upcoming_events');
    expect(canSend).toBe(true);
  });
});
```

#### **Integration Tests**
```typescript
// tests/email/campaigns.integration.test.ts
describe('Campaign Flow', () => {
  it('should create, schedule, and process campaign', async () => {
    // Create campaign
    const campaign = await createCampaign({
      name: 'Test Campaign',
      subject: 'Test',
      body_markdown: '# Hello',
      email_category: 'general_announcements',
      filter_config: { membership_type: ['active'] },
    });

    // Schedule for immediate sending
    await scheduleCampaign(campaign.id, new Date());

    // Run cron job
    await processCampaigns();

    // Verify emails staged
    const emails = await getEmailLogsByCampaign(campaign.id);
    expect(emails.length).toBeGreaterThan(0);

    // Verify campaign status updated
    const updated = await getCampaign(campaign.id);
    expect(updated.status).toBe('sent');
  });
});
```

### 10. **Monitoring & Observability**
Add logging and metrics:

```typescript
// Track important events
console.log({
  event: 'campaign_created',
  campaign_id: campaign.id,
  created_by: userId,
  scheduled_for: campaign.scheduled_for,
  recipient_count: campaign.recipient_count,
});

console.log({
  event: 'campaign_processed',
  campaign_id: campaign.id,
  emails_staged: count,
  duration_ms: processingTime,
});

// Alert on anomalies
if (bounceRate > 0.05) {
  console.error({
    alert: 'high_bounce_rate',
    campaign_id: campaign.id,
    bounce_rate: bounceRate,
  });
}
```

---

## Loops Dashboard Configuration

### New Templates to Create

These templates need to be created in Loops dashboard for non-transactional emails:

| Template Name | Template ID Env Var | Data Variables | Category |
|--------------|---------------------|----------------|----------|
| **Campaign Broadcast** | `LOOPS_CAMPAIGN_BROADCAST_TEMPLATE_ID` | `subject`, `htmlBody`, `unsubscribeUrl`, `userName` | General (dynamic) |
| Membership Expiring (7 days) | `LOOPS_MEMBERSHIP_EXPIRING_7_DAY_TEMPLATE_ID` | `userName`, `membershipName`, `expirationDate`, `renewUrl`, `unsubscribeUrl` | Membership Notifications |
| Membership Expiring (3 days) | `LOOPS_MEMBERSHIP_EXPIRING_3_DAY_TEMPLATE_ID` | `userName`, `membershipName`, `expirationDate`, `renewUrl`, `unsubscribeUrl` | Membership Notifications |
| Membership Expiring (1 day) | `LOOPS_MEMBERSHIP_EXPIRING_1_DAY_TEMPLATE_ID` | `userName`, `membershipName`, `expirationDate`, `renewUrl`, `unsubscribeUrl` | Membership Notifications |
| Captain Team Registration | `LOOPS_CAPTAIN_TEAM_REGISTRATION_TEMPLATE_ID` | `captainName`, `memberName`, `teamName`, `registrationName`, `eventDate`, `teamRosterUrl`, `unsubscribeUrl` | Captain Emails |
| Event Announcement | `LOOPS_EVENT_ANNOUNCEMENT_TEMPLATE_ID` | `userName`, `eventName`, `eventDate`, `registrationOpenDate`, `registrationUrl`, `unsubscribeUrl` | Upcoming Events |

### Template Design Guidelines

**All non-transactional templates MUST include:**
1. Unsubscribe link in footer: `<a href="{{unsubscribeUrl}}">Unsubscribe</a>`
2. Physical address (CAN-SPAM compliance)
3. Clear identification of sender
4. Relevant call-to-action button

**Campaign Broadcast Template Structure:**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{subject}}</title>
  <style>
    /* Email-friendly CSS */
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="YOUR_LOGO_URL" alt="Logo" style="max-width: 150px;">
    </div>

    <div class="content">
      {{{htmlBody}}} <!-- Triple braces = unescaped HTML -->
    </div>

    <div class="footer">
      <p>You're receiving this email because you're subscribed to announcements from [Your Organization].</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe from these emails</a> | <a href="YOUR_SITE_URL/settings/email-preferences">Manage email preferences</a></p>
      <p>[Your Organization Name]<br>[Your Physical Address]</p>
    </div>
  </div>
</body>
</html>
```

### Environment Variables to Add

Add to `.env`:
```env
# Non-transactional email templates
LOOPS_CAMPAIGN_BROADCAST_TEMPLATE_ID=
LOOPS_MEMBERSHIP_EXPIRING_7_DAY_TEMPLATE_ID=
LOOPS_MEMBERSHIP_EXPIRING_3_DAY_TEMPLATE_ID=
LOOPS_MEMBERSHIP_EXPIRING_1_DAY_TEMPLATE_ID=
LOOPS_CAPTAIN_TEAM_REGISTRATION_TEMPLATE_ID=
LOOPS_EVENT_ANNOUNCEMENT_TEMPLATE_ID=

# Unsubscribe token secret
EMAIL_TOKEN_SECRET=

# Optional: Loops API settings
LOOPS_API_RATE_LIMIT=100 # per minute
```

---

## Success Metrics

### Email Deliverability (Technical)
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Delivery Rate | >98% | (delivered / sent) × 100 |
| Bounce Rate | <2% | (bounced / sent) × 100 |
| Spam Complaint Rate | <0.1% | Track via Loops dashboard |
| Processing Time | <5 min | Time from scheduled → all emails staged |

### User Engagement (Campaign Performance)
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Open Rate | >25% | (opened / delivered) × 100 |
| Click-through Rate | >5% | (clicked / delivered) × 100 |
| Unsubscribe Rate | <1% | (unsubscribed / delivered) × 100 |

### Business Impact
| Goal | Baseline | Target | Measurement Period |
|------|----------|--------|-------------------|
| **Membership Renewal Rate** | TBD | +15% | Track renewals before/after expiration warnings |
| **Event Registration Increase** | TBD | +10% | Track registration rates for announced events |
| **Captain Engagement** | TBD | 80% open rate | Track captain notification opens |
| **Support Ticket Reduction** | TBD | -20% | Track email-related support requests |

### Adoption Metrics (Internal)
| Metric | Target | Timeframe |
|--------|--------|-----------|
| Campaigns Created | 4/month | First 3 months |
| Admin Users Trained | 100% | First month |
| User Preference Updates | <5% global unsubscribe | First 6 months |

### Data Quality
| Metric | Target | Notes |
|--------|--------|-------|
| Email Bounce Rate | <2% | Monitor for invalid emails |
| Preference Data Completeness | 100% | All users have default preferences |
| Campaign Analytics Accuracy | 100% | All campaigns have complete stats |

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|------------|-------|
| **High spam/unsubscribe rates** | HIGH | MEDIUM | Start with small test campaigns; monitor unsubscribe rates; only send valuable content | Product |
| **Loops API rate limiting** | MEDIUM | MEDIUM | Implement backoff logic; batch processing; monitor rate limits | Engineering |
| **Markdown XSS vulnerabilities** | HIGH | LOW | Sanitize all HTML output; whitelist allowed tags; security review | Engineering |
| **Campaign sent to wrong audience** | MEDIUM | MEDIUM | Add preview step; require confirmation; show recipient count | Product |
| **Database performance degradation** | MEDIUM | LOW | Add indexes; optimize queries; monitor query performance | Engineering |
| **Email deliverability issues** | MEDIUM | MEDIUM | Monitor bounce rates; maintain clean email list; implement SPF/DKIM | Operations |
| **Accidental campaign launch** | MEDIUM | LOW | Require explicit schedule action; no auto-send; add "Are you sure?" confirmation | Product |
| **Users miss important emails** | HIGH | MEDIUM | Keep transactional emails separate; educate users about categories; sensible defaults | Product |
| **Admin creates malicious content** | MEDIUM | LOW | Sanitize markdown; audit trail; require admin permissions | Engineering |
| **Concurrent campaign processing** | LOW | LOW | Use database locks (SKIP LOCKED); transaction isolation | Engineering |
| **Data privacy/GDPR compliance** | HIGH | LOW | Include unsubscribe; honor preferences immediately; document data handling | Legal/Engineering |
| **Template configuration errors** | MEDIUM | MEDIUM | Validate template IDs; test before production; comprehensive testing checklist | Engineering |

### Risk Mitigation Strategies

#### **Content Quality Control**
1. Require internal review for first 5 campaigns
2. Create campaign templates/best practices guide
3. Monitor engagement metrics closely
4. A/B test campaign content

#### **Technical Safeguards**
1. Add "Send Test" feature before scheduling
2. Implement preview recipient list before sending
3. Add rate limiting on campaign creation
4. Log all campaign actions for audit trail
5. Add rollback capability for drafts

#### **User Protection**
1. Set sensible default preferences (all opted-in)
2. Make unsubscribe prominent and easy
3. Honor unsubscribe requests immediately
4. Never re-subscribe users without explicit consent
5. Explain each category clearly

#### **Monitoring & Alerts**
1. Alert on high bounce rates (>5%)
2. Alert on high unsubscribe rates (>5%)
3. Monitor cron job failures
4. Track processing times
5. Review campaign performance weekly

---

## Next Steps

### Pre-Implementation (Week 0)
**Goal:** Validate plan and prepare for development

- [ ] **Review plan with stakeholders** - Ensure alignment on scope and timeline
- [ ] **Prioritize email categories** - Which categories are most important?
- [ ] **Define campaign use cases** - What will first campaigns be about?
- [ ] **Assign development resources** - Who will build this?
- [ ] **Set up project tracking** - Create tickets/issues for each phase
- [ ] **Review Loops account limits** - Verify email volume limits won't be exceeded

### Phase 1 Kickoff (Week 1)
**Goal:** Begin development on subscription management

- [ ] **Create feature branch** - `feature/non-transactional-emails`
- [ ] **Set up development environment** - Install dependencies, configure Loops test account
- [ ] **Create database migrations** - Email preferences and campaigns tables
- [ ] **Begin implementing preference service** - Core business logic
- [ ] **Daily standups** - Track progress, identify blockers

### Weekly Milestones

#### Week 1-2: Foundation
- [ ] Complete Phase 1.1-1.4 (subscription management)
- [ ] Deploy to staging for testing
- [ ] Internal QA on preference UI

#### Week 2-3: Automated Emails
- [ ] Complete Phase 2.1-2.3 (membership warnings, captain notifications, events)
- [ ] Create Loops templates
- [ ] Test automated triggers in staging

#### Week 3-4: Backend Infrastructure
- [ ] Complete Phase 3.1-3.5 (campaign service, recipient filtering, API routes)
- [ ] Test campaign processing cron job
- [ ] Load test with 1000+ recipients

#### Week 4-5: Admin UI
- [ ] Complete Phase 4.1-4.4 (campaign composer, management, analytics)
- [ ] Internal admin training session
- [ ] Gather feedback and iterate

#### Week 5-6: Integration & Testing
- [ ] Complete Phase 5.1-5.5 (Loops setup, testing, documentation, security)
- [ ] Comprehensive QA testing
- [ ] Fix bugs and polish UI

#### Week 6: Launch
- [ ] Complete Phase 6.1-6.4 (optimization, training, deployment)
- [ ] Soft launch with test campaign
- [ ] Full launch and monitoring

### Post-Launch (Week 7+)
**Goal:** Monitor, iterate, and improve

- [ ] **Week 7:** Monitor first campaigns, gather feedback
- [ ] **Week 8:** Iterate on UI based on admin feedback
- [ ] **Week 9:** Analyze email engagement metrics
- [ ] **Week 10:** Document learnings and best practices
- [ ] **Month 2-3:** Build additional features based on usage patterns

---

## Questions to Resolve

### Technical Questions
1. **Loops Account Limits**
   - What's the current Loops plan tier?
   - What are the monthly email volume limits?
   - What are the API rate limits?
   - Do we need to upgrade for expected volume?

2. **Email Authentication**
   - Is SPF/DKIM/DMARC configured for sending domain?
   - Who manages DNS records?
   - Do we need to add/update any records?

3. **Markdown Editor**
   - Should we use a specific markdown editor library (e.g., SimpleMDE, Editor.js)?
   - Do we want WYSIWYG or split preview?
   - Should we support image uploads or just external URLs?

4. **Analytics Integration**
   - Use Loops analytics or build custom dashboard?
   - Do we need real-time stats or batch updates?
   - Should we integrate with other analytics tools (Google Analytics, Mixpanel)?

### Business/Product Questions
5. **Email Categories**
   - Are the proposed categories correct?
   - Do we need additional categories?
   - Should any categories be combined?

6. **Default Preferences**
   - Should new users be opted-in by default to all categories?
   - Or opt-out by default (except transactional)?
   - What's the legal requirement?

7. **Campaign Approval Process**
   - Do campaigns need approval before sending?
   - Who can create campaigns? (all admins or specific role?)
   - Should there be different permission levels?

8. **Content Guidelines**
   - Do we need brand guidelines for campaign content?
   - Should there be character/word limits?
   - Who reviews campaign quality?

### Compliance Questions
9. **Legal Requirements**
   - Are we subject to GDPR, CAN-SPAM, CASL, or other regulations?
   - Do we need explicit opt-in for any categories?
   - What's required in the email footer?
   - Do we need to log consent records?

10. **Data Retention**
    - How long should we keep email logs?
    - Should old campaigns be archived or deleted?
    - What about unsubscribed user data?

### Operational Questions
11. **Template Management**
    - Who creates and maintains Loops templates? (dev team, marketing, admins?)
    - What's the approval process for new templates?
    - How do we test templates before production?

12. **Support & Training**
    - Who trains admins on the campaign system?
    - What documentation do admins need?
    - Who supports admins when they have questions?

13. **Campaign Frequency**
    - Is there a maximum frequency for campaigns? (e.g., max 1/week?)
    - Should we enforce sending limits?
    - How do we prevent campaign fatigue?

### Answers/Decisions Log
*Document decisions here as they're made*

- **Q1 (Loops Limits):** [To be answered]
- **Q5 (Email Categories):** Confirmed: captain_emails, upcoming_events, general_announcements, membership_notifications, feature_announcements
- **Q6 (Default Preferences):** [To be answered]
- ...

---

## Resources

- **Loops Documentation:** https://loops.so/docs
- **Current Architecture Doc:** `/docs/architecture/email-architecture.md`
- **Email Service Code:** `/src/lib/email/service.ts`
- **Loops Dashboard:** https://app.loops.so/
- **Email Logs Schema:** `/supabase/schema.sql` (lines 800-850)

---

## Appendix: Code Examples

### Example 1: Checking Email Preferences Before Sending

```typescript
// src/lib/email/preferences.ts
import { db } from '@/lib/db';
import { EMAIL_CATEGORIES } from './categories';

export async function canSendEmail(
  userId: string,
  emailCategory: string
): Promise<{ canSend: boolean; reason?: string }> {
  // Transactional emails always send
  if (emailCategory === EMAIL_CATEGORIES.TRANSACTIONAL) {
    return { canSend: true };
  }

  // Get user preferences
  const prefs = await db.query(
    'SELECT * FROM email_preferences WHERE user_id = $1',
    [userId]
  );

  // If no preferences exist, create defaults (opted-in)
  if (prefs.rows.length === 0) {
    await createDefaultPreferences(userId);
    return { canSend: true };
  }

  const preferences = prefs.rows[0];

  // Check global unsubscribe
  if (preferences.globally_unsubscribed) {
    return { canSend: false, reason: 'user_globally_unsubscribed' };
  }

  // Check category-specific preference
  if (preferences[emailCategory] === false) {
    return { canSend: false, reason: `category_disabled: ${emailCategory}` };
  }

  return { canSend: true };
}
```

### Example 2: Staging Email with Preference Check

```typescript
// src/lib/email/staging.ts
export async function stageEmailWithPreferenceCheck(params: {
  userId: string;
  email: string;
  emailCategory: string;
  templateId: string;
  subject: string;
  emailData: any;
  campaignId?: string;
}) {
  // Check if user can receive this email
  const { canSend, reason } = await canSendEmail(params.userId, params.emailCategory);

  if (!canSend) {
    // Log that we skipped this email
    await db.query(
      `INSERT INTO email_logs (user_id, email_address, email_category, subject,
        status, skipped_reason, campaign_id, created_at)
       VALUES ($1, $2, $3, $4, 'skipped', $5, $6, NOW())`,
      [params.userId, params.email, params.emailCategory, params.subject, reason, params.campaignId]
    );
    return { staged: false, reason };
  }

  // Stage the email for sending
  await db.query(
    `INSERT INTO email_logs (user_id, email_address, email_category, template_id,
      subject, email_data, status, campaign_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())`,
    [params.userId, params.email, params.emailCategory, params.templateId,
     params.subject, JSON.stringify(params.emailData), params.campaignId]
  );

  return { staged: true };
}
```

### Example 3: Creating and Processing a Campaign

```typescript
// src/lib/email/campaigns.ts
import { markdownToSafeHtml } from './markdown';
import { getRecipientList } from './campaign-recipients';
import { stageEmailWithPreferenceCheck } from './staging';

export async function createCampaign(data: {
  name: string;
  subject: string;
  bodyMarkdown: string;
  emailCategory: string;
  filterConfig: any;
  createdBy: string;
}) {
  // Convert markdown to HTML
  const bodyHtml = markdownToSafeHtml(data.bodyMarkdown);

  // Get recipient count
  const recipients = await getRecipientList(data.filterConfig);
  const recipientIds = recipients.map(r => r.id);

  // Create campaign record
  const result = await db.query(
    `INSERT INTO email_campaigns
     (name, subject, body_markdown, body_html, email_category, filter_config,
      recipient_count, recipient_list, created_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
     RETURNING *`,
    [data.name, data.subject, data.bodyMarkdown, bodyHtml, data.emailCategory,
     JSON.stringify(data.filterConfig), recipients.length, JSON.stringify(recipientIds),
     data.createdBy]
  );

  return result.rows[0];
}

export async function scheduleCampaign(
  campaignId: string,
  scheduledFor: Date
) {
  await db.query(
    `UPDATE email_campaigns
     SET status = 'scheduled', scheduled_for = $1, updated_at = NOW()
     WHERE id = $2`,
    [scheduledFor, campaignId]
  );
}

export async function processCampaign(campaign: any) {
  // Mark as processing
  await db.query(
    `UPDATE email_campaigns SET status = 'processing', started_sending_at = NOW()
     WHERE id = $1`,
    [campaign.id]
  );

  // Get fresh recipient list (apply filters again in case data changed)
  const recipients = await getRecipientList(campaign.filter_config);

  // Get template ID
  const templateId = process.env.LOOPS_CAMPAIGN_BROADCAST_TEMPLATE_ID;

  let stagedCount = 0;
  let skippedCount = 0;

  // Stage emails for each recipient
  for (const recipient of recipients) {
    const unsubscribeToken = await generateUnsubscribeToken(recipient.id);
    const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?token=${unsubscribeToken}`;

    const result = await stageEmailWithPreferenceCheck({
      userId: recipient.id,
      email: recipient.email,
      emailCategory: campaign.email_category,
      templateId,
      subject: campaign.subject,
      campaignId: campaign.id,
      emailData: {
        subject: campaign.subject,
        htmlBody: campaign.body_html,
        unsubscribeUrl,
        userName: recipient.name,
      },
    });

    if (result.staged) {
      stagedCount++;
    } else {
      skippedCount++;
    }
  }

  // Update campaign with results
  await db.query(
    `UPDATE email_campaigns
     SET status = 'sent', completed_sending_at = NOW(),
         total_staged = $1
     WHERE id = $2`,
    [stagedCount, campaign.id]
  );

  return { stagedCount, skippedCount };
}
```

### Example 4: Recipient Filtering

```typescript
// src/lib/email/campaign-recipients.ts
export async function getRecipientList(filterConfig: {
  membershipTypes?: string[];
  registrationEventIds?: string[];
  userRoles?: string[];
  emailCategory: string;
}): Promise<Recipient[]> {
  let query = `
    SELECT DISTINCT u.id, u.email, u.name, u.membership_type, u.is_admin
    FROM users u
    INNER JOIN email_preferences ep ON ep.user_id = u.id
    WHERE 1=1
  `;

  const params: any[] = [];
  let paramIndex = 1;

  // Filter by email preferences
  query += ` AND ep.globally_unsubscribed = FALSE`;
  query += ` AND ep.${filterConfig.emailCategory} = TRUE`;

  // Filter by membership type
  if (filterConfig.membershipTypes && filterConfig.membershipTypes.length > 0) {
    query += ` AND u.membership_type = ANY($${paramIndex})`;
    params.push(filterConfig.membershipTypes);
    paramIndex++;
  }

  // Filter by registration status
  if (filterConfig.registrationEventIds && filterConfig.registrationEventIds.length > 0) {
    query += `
      AND EXISTS (
        SELECT 1 FROM registrations r
        WHERE r.user_id = u.id
        AND r.event_id = ANY($${paramIndex})
        AND r.status = 'completed'
      )
    `;
    params.push(filterConfig.registrationEventIds);
    paramIndex++;
  }

  // Filter by role
  if (filterConfig.userRoles && filterConfig.userRoles.includes('captain')) {
    query += `
      AND EXISTS (
        SELECT 1 FROM team_captains tc
        WHERE tc.user_id = u.id
      )
    `;
  }

  if (filterConfig.userRoles && filterConfig.userRoles.includes('admin')) {
    query += ` AND u.is_admin = TRUE`;
  }

  query += ` ORDER BY u.name`;

  const result = await db.query(query, params);
  return result.rows;
}
```

### Example 5: Campaign Cron Job

```typescript
// src/app/api/cron/email-campaigns/route.ts
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get campaigns that are due to be sent
    const result = await db.query(
      `SELECT * FROM email_campaigns
       WHERE status = 'scheduled'
       AND scheduled_for <= NOW()
       ORDER BY scheduled_for
       FOR UPDATE SKIP LOCKED` // Prevent concurrent processing
    );

    const campaigns = result.rows;
    const processed = [];

    for (const campaign of campaigns) {
      try {
        const stats = await processCampaign(campaign);
        processed.push({
          id: campaign.id,
          name: campaign.name,
          ...stats,
        });
      } catch (error) {
        console.error(`Failed to process campaign ${campaign.id}:`, error);
        await db.query(
          `UPDATE email_campaigns
           SET status = 'failed', error_message = $1
           WHERE id = $2`,
          [error.message, campaign.id]
        );
      }
    }

    return Response.json({
      success: true,
      processed: processed.length,
      campaigns: processed,
    });
  } catch (error) {
    console.error('Campaign cron job failed:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

### Example 6: User Preferences UI Component

```typescript
// src/components/email-preferences/PreferencesForm.tsx
'use client';

import { useState } from 'react';
import { CATEGORY_LABELS, EMAIL_CATEGORIES } from '@/lib/email/categories';

export function PreferencesForm({ initialPreferences }) {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [saving, setSaving] = useState(false);

  const handleGlobalToggle = (checked: boolean) => {
    setPrefs({
      ...prefs,
      globally_unsubscribed: !checked,
      // Disable all categories if globally unsubscribing
      captain_emails: checked,
      upcoming_events: checked,
      general_announcements: checked,
      membership_notifications: checked,
      feature_announcements: checked,
    });
  };

  const handleCategoryToggle = (category: string, checked: boolean) => {
    // Only allow if not globally unsubscribed
    if (!prefs.globally_unsubscribed) {
      setPrefs({ ...prefs, [category]: checked });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/email-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      // Show success message
    } catch (error) {
      // Show error message
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <label className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={!prefs.globally_unsubscribed}
            onChange={(e) => handleGlobalToggle(e.target.checked)}
            className="h-5 w-5"
          />
          <div>
            <div className="font-medium">Email Notifications</div>
            <div className="text-sm text-gray-600">
              Receive non-transactional emails from us
            </div>
          </div>
        </label>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium text-gray-700">Email Categories</h3>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <label key={key} className="flex items-center space-x-3 opacity-{prefs.globally_unsubscribed ? '50' : '100'}">
            <input
              type="checkbox"
              checked={prefs[key]}
              onChange={(e) => handleCategoryToggle(key, e.target.checked)}
              disabled={prefs.globally_unsubscribed}
              className="h-4 w-4"
            />
            <span className="text-sm">{label}</span>
          </label>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
```

---

## Related Documentation

- **Current Email Architecture:** `/docs/architecture/email-architecture.md`
- **Email Service Code:** `/src/lib/email/service.ts`
- **Loops API Documentation:** https://loops.so/docs/api-reference
- **CAN-SPAM Compliance:** https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business

---

**Document Owner:** Development Team
**Last Updated:** 2026-01-22
**Next Review:** After stakeholder review
**Status:** Draft - Awaiting approval
