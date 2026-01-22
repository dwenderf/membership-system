# Email Integration Plan - Loops.so

**Date:** 2026-01-22
**Status:** Planning Phase
**Current Integration:** Loops.so (Active)

---

## Executive Summary

The membership system has a comprehensive email infrastructure already integrated with Loops.so. This plan documents the current state and proposes enhancements to maximize the value of the email system.

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

## Gaps & Opportunities

### 1. **Missing Email Types**

| Email Type | Priority | Use Case | Effort |
|-----------|----------|----------|--------|
| **Membership expiration warning** | HIGH | Remind users before membership expires (7 days, 3 days, 1 day) | Medium |
| **Email change verification** | HIGH | Confirm email change for security | Low |
| **Password reset** | MEDIUM | Allow users to reset forgotten passwords | Medium |
| **Newsletter/Announcements** | MEDIUM | Broadcast updates to members | Low |
| **Event reminders** | MEDIUM | Remind users of upcoming registered events | Medium |
| **Abandoned cart recovery** | LOW | Recover incomplete registrations/memberships | Medium |
| **Receipt/Invoice PDFs** | LOW | Attach detailed receipts to confirmation emails | High |

### 2. **Configuration & Operations**

**Missing:**
- ❌ Template configuration documentation (which Loops template IDs map to which emails)
- ❌ Email preview/testing UI in admin dashboard
- ❌ Email analytics dashboard (open rates, click rates, bounces)
- ❌ Retry configuration (currently logs but doesn't retry failed emails)
- ❌ Email scheduling (send at specific time/date)
- ❌ User email preferences (opt-in/opt-out management)

**Partially Implemented:**
- ⚠️ Membership expiration detection (cron job exists but email not sent)
- ⚠️ Email retry logic (infrastructure exists but not active)

### 3. **Loops Features Not Utilized**

- **Contact Properties**: Sync user data to Loops for segmentation
- **Custom Events**: Track user behavior beyond email sends
- **Mailing Lists**: Segment users for targeted campaigns
- **Contact Management**: Keep Loops contact database in sync with app users
- **Webhooks**: Receive delivery/engagement events from Loops

---

## Recommended Implementation Roadmap

### Phase 1: Critical Gaps (1-2 weeks)

#### 1.1 **Membership Expiration Emails** ⭐ HIGH PRIORITY
**Goal:** Reduce membership lapses by warning users before expiration

**Implementation:**
- [ ] Create Loops templates for expiration warnings (7-day, 3-day, 1-day)
- [ ] Update cron job `/api/cron/membership-expiration-check` to stage emails
- [ ] Add `sendMembershipExpirationWarning()` logic to `EmailService`
- [ ] Test with upcoming expiring memberships

**Files to modify:**
- `src/lib/email/service.ts` (add method)
- `src/app/api/cron/membership-expiration-check/route.ts` (stage emails)
- `src/lib/email/constants.ts` (add EMAIL_EVENTS)

**Env vars needed:**
```env
LOOPS_MEMBERSHIP_EXPIRING_7_DAY_TEMPLATE_ID=
LOOPS_MEMBERSHIP_EXPIRING_3_DAY_TEMPLATE_ID=
LOOPS_MEMBERSHIP_EXPIRING_1_DAY_TEMPLATE_ID=
```

**Deliverables:**
- Automated email warnings before membership expiration
- Database tracking of expiration emails sent
- Cron job integration

---

#### 1.2 **Email Retry Logic** ⭐ HIGH PRIORITY
**Goal:** Ensure failed emails are retried automatically

**Implementation:**
- [ ] Enhance `EmailProcessingManager` to process failed emails
- [ ] Add exponential backoff for retries (1 hour, 4 hours, 24 hours)
- [ ] Maximum 3 retry attempts before permanent failure
- [ ] Update `email_logs` with retry count and next retry time

**Files to modify:**
- `src/lib/email/batch-sync-email.ts` (implement retry processing)
- `supabase/migrations/` (add retry_count, next_retry_at columns)

**Schema changes:**
```sql
ALTER TABLE email_logs ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN next_retry_at TIMESTAMP;
CREATE INDEX idx_email_logs_retry ON email_logs(status, next_retry_at)
  WHERE status = 'failed';
```

**Deliverables:**
- Automatic retry of failed emails
- Exponential backoff implementation
- Admin visibility into retry status

---

#### 1.3 **Template Configuration Documentation**
**Goal:** Document all Loops template mappings for team reference

**Implementation:**
- [ ] Create `/docs/loops-template-mapping.md`
- [ ] Document each email type with template ID, sample data, triggers
- [ ] Include screenshots of Loops templates
- [ ] Add setup instructions for new Loops accounts

**Deliverables:**
- Comprehensive template documentation
- Onboarding guide for new developers
- Template testing checklist

---

### Phase 2: User Experience Enhancements (2-3 weeks)

#### 2.1 **Event Reminder Emails**
**Goal:** Reduce no-shows by reminding users of upcoming events

**Implementation:**
- [ ] Add cron job for event reminders (24 hours, 2 hours before)
- [ ] Create Loops templates for event reminders
- [ ] Include event details, location, team info, calendar links
- [ ] Add opt-out mechanism for reminders

**Files to create:**
- `src/app/api/cron/event-reminders/route.ts`
- `src/lib/email/event-reminders.ts`

**Env vars:**
```env
LOOPS_EVENT_REMINDER_24H_TEMPLATE_ID=
LOOPS_EVENT_REMINDER_2H_TEMPLATE_ID=
```

---

#### 2.2 **Email Change Verification**
**Goal:** Secure email changes with verification step

**Implementation:**
- [ ] Add email change verification flow
- [ ] Generate secure tokens for verification
- [ ] Create Loops template for verification email
- [ ] Add verification endpoint `/api/verify-email-change`

**Files to create:**
- `src/lib/email/email-verification.ts`
- `src/app/api/verify-email-change/route.ts`

**Security considerations:**
- Use cryptographically secure tokens
- Set token expiration (24 hours)
- Send notification to old email address
- Require re-authentication for email changes

---

#### 2.3 **User Email Preferences**
**Goal:** Allow users to control which emails they receive

**Implementation:**
- [ ] Add `email_preferences` table (transactional, marketing, reminders)
- [ ] Create preferences UI in user settings
- [ ] Update email methods to check preferences before sending
- [ ] Add unsubscribe links to appropriate emails

**Schema:**
```sql
CREATE TABLE email_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    transactional_emails BOOLEAN DEFAULT TRUE, -- Cannot opt out
    marketing_emails BOOLEAN DEFAULT TRUE,
    event_reminders BOOLEAN DEFAULT TRUE,
    payment_reminders BOOLEAN DEFAULT TRUE,
    membership_notifications BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**Files to create:**
- `src/app/settings/email-preferences/page.tsx`
- `src/lib/email/preferences.ts`

---

### Phase 3: Admin & Analytics (2-3 weeks)

#### 3.1 **Email Analytics Dashboard**
**Goal:** Provide visibility into email performance

**Implementation:**
- [ ] Create admin dashboard page for email analytics
- [ ] Display metrics: total sent, delivered, opened, clicked, bounced
- [ ] Filter by email type, date range, user
- [ ] Charts for open rates, click rates over time
- [ ] Export capability for reporting

**Data sources:**
- `email_logs` table (sent, delivered, opened, clicked timestamps)
- Loops API webhooks (real-time delivery events)

**Files to create:**
- `src/app/admin/email-analytics/page.tsx`
- `src/lib/email/analytics.ts`

**Metrics to track:**
- Delivery rate: (delivered / sent) × 100
- Open rate: (opened / delivered) × 100
- Click rate: (clicked / delivered) × 100
- Bounce rate: (bounced / sent) × 100

---

#### 3.2 **Email Testing & Preview UI**
**Goal:** Allow admins to preview and test emails before sending

**Implementation:**
- [ ] Create admin page for email testing
- [ ] Render email templates with sample data
- [ ] Send test emails to specified addresses
- [ ] Validate template IDs and data structure

**Files to create:**
- `src/app/admin/email-testing/page.tsx`
- `src/lib/email/testing.ts`

**Features:**
- Dropdown to select email type
- Form to enter sample data
- Preview pane showing rendered template
- "Send Test Email" button
- Validation feedback

---

#### 3.3 **Loops Contact Sync**
**Goal:** Keep Loops contact database synchronized with app users

**Implementation:**
- [ ] Sync user data to Loops on account creation/update
- [ ] Update contact properties: name, membership status, registration count
- [ ] Use Loops Mailing Lists for segmentation (members, non-members, expired)
- [ ] Handle contact deletion on account deletion

**Files to create:**
- `src/lib/email/contact-sync.ts`

**Contact properties to sync:**
- Email, first name, last name
- Membership status (active, expired, never had)
- Membership type and expiration date
- Total registrations count
- Last registration date
- Account created date
- User timezone

**Mailing lists:**
- Active Members
- Expired Members
- Event Registrants
- Waitlisted Users

---

### Phase 4: Advanced Features (Optional)

#### 4.1 **Newsletter & Announcements**
- Broadcast capability for admin messages
- Rich text editor for composing
- Send to all users or filtered segments
- Schedule sending for future date/time

#### 4.2 **Abandoned Cart Recovery**
- Track incomplete registration/membership flows
- Send reminder email after 1 hour, 24 hours
- Include direct link to complete purchase

#### 4.3 **Receipt PDFs**
- Generate PDF receipts for purchases
- Attach to confirmation emails
- Store in secure blob storage

#### 4.4 **Loops Webhooks**
- Receive delivery events from Loops
- Update `email_logs` with real-time status
- Handle bounces, spam reports, unsubscribes

---

## Technical Recommendations

### 1. **Environment Variable Management**
Create `.env.example` with all Loops template IDs:
```env
# Loops Configuration
LOOPS_API_KEY=your_api_key_here

# Template IDs (get from Loops dashboard)
LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID=
LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID=
LOOPS_WAITLIST_ADDED_TEMPLATE_ID=
# ... (add all template IDs)
```

### 2. **Error Monitoring**
- Add Sentry/error tracking for email failures
- Alert on high bounce rates (>5%)
- Monitor Loops API rate limits

### 3. **Testing Strategy**
- Unit tests for email service methods
- Integration tests for email staging
- E2E tests for critical flows (purchase → email)
- Manual testing checklist for new templates

### 4. **Performance Optimization**
- Batch email staging operations (single DB insert for multiple emails)
- Implement parallel processing in cron job (process multiple emails concurrently)
- Add database indexes for common queries
- Cache Loops API client instance

### 5. **Security Considerations**
- Validate email addresses before sending
- Sanitize user input in email templates
- Use secure tokens for verification emails
- Rate limit email sending per user
- Prevent email enumeration attacks

---

## Loops Dashboard Configuration

### Templates to Create in Loops

| Template Name | Template ID Env Var | Data Variables |
|--------------|---------------------|----------------|
| Membership Purchase Confirmation | `LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID` | `userName`, `membershipName`, `amount`, `expirationDate`, `dashboardUrl` |
| Registration Confirmation | `LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID` | `userName`, `registrationName`, `eventDate`, `teamName`, `amount`, `dashboardUrl` |
| Waitlist Added | `LOOPS_WAITLIST_ADDED_TEMPLATE_ID` | `userName`, `registrationName`, `eventDate`, `waitlistPosition` |
| Membership Expiring (7 days) | `LOOPS_MEMBERSHIP_EXPIRING_7_DAY_TEMPLATE_ID` | `userName`, `membershipName`, `expirationDate`, `renewUrl` |
| Event Reminder (24 hours) | `LOOPS_EVENT_REMINDER_24H_TEMPLATE_ID` | `userName`, `eventName`, `eventDate`, `location`, `teamName`, `calendarLink` |

### Custom Events to Track
- `membership.purchased`
- `registration.completed`
- `payment.failed`
- `account.created`
- `membership.renewed`

### Contact Properties to Define
- `membership_status` (active, expired, none)
- `membership_type` (standard, premium, etc.)
- `membership_expires_at`
- `total_registrations`
- `last_registration_date`
- `account_created_at`

---

## Success Metrics

### Email Deliverability
- **Target:** >98% delivery rate
- **Current:** Monitor in Phase 3

### User Engagement
- **Target:** >30% open rate for transactional emails
- **Target:** >15% click rate for emails with CTAs

### Business Impact
- **Membership renewal rate:** Track before/after expiration warnings
- **Event attendance:** Track no-show rate before/after reminders
- **Support tickets:** Reduce email-related support requests

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Loops API downtime | HIGH | LOW | Graceful degradation already implemented; emails staged in DB |
| Email deliverability issues | MEDIUM | MEDIUM | Monitor bounce rates; implement SPF/DKIM/DMARC |
| Spam complaints | MEDIUM | LOW | Include unsubscribe links; respect preferences |
| Template configuration errors | LOW | MEDIUM | Add validation; comprehensive testing |
| Data privacy concerns | HIGH | LOW | Audit email data sent to Loops; minimize PII |

---

## Next Steps

### Immediate Actions (This Week)
1. ✅ Review this plan with stakeholders
2. ⬜ Prioritize Phase 1 features
3. ⬜ Audit current Loops templates (verify all exist and are correct)
4. ⬜ Document existing template IDs in `.env.example`
5. ⬜ Create Loops templates for missing email types

### Short-term (Next 2 Weeks)
1. ⬜ Implement membership expiration emails (Phase 1.1)
2. ⬜ Implement email retry logic (Phase 1.2)
3. ⬜ Create template documentation (Phase 1.3)

### Medium-term (Next Month)
1. ⬜ Begin Phase 2 features (event reminders, email preferences)
2. ⬜ Set up email analytics dashboard
3. ⬜ Implement Loops contact sync

---

## Questions to Resolve

1. **Loops Plan Limits:** What's the current Loops plan? Email volume limits?
2. **Domain Authentication:** Is SPF/DKIM/DMARC configured for sending domain?
3. **Template Ownership:** Who maintains Loops templates (dev team vs marketing)?
4. **Compliance:** Any GDPR/CAN-SPAM requirements for email preferences?
5. **Analytics:** Should we use Loops analytics or build custom dashboard?
6. **Sending Limits:** Any rate limiting needed per user (e.g., max 10 emails/day)?

---

## Resources

- **Loops Documentation:** https://loops.so/docs
- **Current Architecture Doc:** `/docs/architecture/email-architecture.md`
- **Email Service Code:** `/src/lib/email/service.ts`
- **Loops Dashboard:** https://app.loops.so/
- **Email Logs Schema:** `/supabase/schema.sql` (lines 800-850)

---

## Appendix: Code Examples

### Example: Adding New Email Type

```typescript
// 1. Add event constant
export const EMAIL_EVENTS = {
  // ... existing events
  EVENT_REMINDER: 'event.reminder',
} as const;

// 2. Add method to EmailService
async sendEventReminder(params: {
  userId: string;
  email: string;
  eventName: string;
  eventDate: Date;
  location: string;
}) {
  const templateId = process.env.LOOPS_EVENT_REMINDER_24H_TEMPLATE_ID;
  if (!templateId) {
    console.warn('Event reminder template ID not configured');
    return;
  }

  await this.sendEmailImmediately({
    to: params.email,
    templateId,
    dataVariables: {
      userName: await getUserName(params.userId),
      eventName: params.eventName,
      eventDate: formatDate(params.eventDate),
      location: params.location,
    },
  });

  await this.logEmailToDatabase({
    userId: params.userId,
    email: params.email,
    eventType: EMAIL_EVENTS.EVENT_REMINDER,
    subject: `Reminder: ${params.eventName} tomorrow`,
    templateId,
    emailData: params,
    triggeredBy: 'automated',
  });
}

// 3. Call from cron job
export async function GET(request: Request) {
  const upcomingEvents = await getEventsInNext24Hours();

  for (const event of upcomingEvents) {
    await emailService.sendEventReminder({
      userId: event.userId,
      email: event.userEmail,
      eventName: event.name,
      eventDate: event.date,
      location: event.location,
    });
  }

  return Response.json({ sent: upcomingEvents.length });
}
```

---

**Document Owner:** Development Team
**Last Updated:** 2026-01-22
**Next Review:** After Phase 1 completion
