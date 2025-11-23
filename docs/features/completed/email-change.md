# Email Change Feature

## Overview

This document outlines the implementation of a secure email change feature for users in the membership system. The feature allows authenticated users to update their email address with proper verification, security controls, and integration with Supabase Auth and Xero contacts.

**Status:** Planning - Ready for implementation
**Priority:** Medium - User-requested feature
**Security Level:** High - Requires re-authentication and email verification

---

## Problem Statement

Currently, users cannot change their email address themselves. The account edit page displays: "Email address cannot be changed. Contact support if you need to update your email."

Users need the ability to:
- Update their email address for authentication
- Receive communications at their current email
- Keep their Xero contact information synchronized

### Security Challenges

1. **Email Enumeration Prevention**: Attackers must not be able to discover if an email exists in the system by attempting to change to various email addresses
2. **Account Takeover Prevention**: Must verify both that the user owns the current account AND the new email address
3. **Session Security**: Email changes should require recent authentication to prevent attacks on unattended sessions
4. **Rate Limiting**: Prevent abuse through excessive email change attempts

---

## Requirements

### Functional Requirements

1. **User Authentication**: User must be logged in and have re-authenticated within the last 5 minutes
2. **Email Verification**: User must verify ownership of the new email address via a verification code
3. **Notifications**:
   - Security alert sent to old email when change is requested
   - Verification code sent to new email
   - Confirmation sent to both emails when change completes
4. **Supabase Auth Sync**: Email must be updated in both `auth.users` and public `users` table
5. **Xero Integration**: Contact email must be updated in Xero (non-blocking)
6. **Audit Trail**: All email change attempts must be logged for security purposes

### Non-Functional Requirements

1. **Security**: Anti-enumeration, rate limiting, secure verification codes
2. **User Experience**: Clear modal-based flow with helpful messaging
3. **Reliability**: Atomic database updates, graceful Xero sync failure handling
4. **Performance**: Email delivery within seconds, verification code expires in 15 minutes

---

## Architecture Overview

### Flow Diagram

```
User clicks "Change Email" button
    ↓
Check session age (< 5 min?)
    ↓ NO → Re-authentication Modal
    |       ↓
    |   Send magic link to current email
    |       ↓
    |   User clicks link, returns with fresh session
    |       ↓
    ↓ YES
Open Email Change Modal - Step 1: Enter New Email
    ↓
User enters new email, clicks "Send Verification Code"
    ↓
API validates (don't reveal if email exists) and creates request
    ↓
Send verification code to NEW email
Send security alert to OLD email
    ↓
Modal Step 2: Enter Verification Code
    ↓
User enters 6-digit code, clicks "Confirm"
    ↓
API verifies code and updates email atomically:
  - Update auth.users (Supabase Auth API)
  - Update users table
  - Log to email_change_logs
    ↓
Sync to Xero (non-blocking, log errors)
    ↓
Send confirmation to both emails
    ↓
Success! Modal closes, UI updates
```

### Components

1. **Database Tables**
   - `email_change_requests` - Pending change requests with verification codes
   - `email_change_logs` - Audit trail of all email change activity

2. **API Endpoints**
   - `POST /api/user/email/request-change` - Initiates email change, sends verification code
   - `POST /api/user/email/confirm-change` - Verifies code and completes email update

3. **Frontend Components**
   - `ReauthenticationModal` - Handles fresh authentication requirement
   - `EmailChangeModal` - Two-step modal for email change and verification
   - Updated account page with "Change Email" button

4. **Email Templates** (Loops.so)
   - `email_change_verification` - 6-digit code sent to new email
   - `email_change_security_alert` - Alert sent to old email
   - `email_change_confirmed` - Confirmation sent to both emails

---

## Implementation Details

### Phase 1: Database Schema

#### Migration 1: Email Change Requests Table

**File:** `supabase/migrations/YYYY-MM-DD-create-email-change-requests.sql`

```sql
-- Email change requests with verification codes
CREATE TABLE email_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  verification_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'completed', 'expired', 'cancelled')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Ensure user can only have one active request at a time
  CONSTRAINT one_active_request_per_user UNIQUE (user_id, status)
    DEFERRABLE INITIALLY DEFERRED
);

-- Index for finding active requests
CREATE INDEX idx_email_change_requests_user_status
  ON email_change_requests(user_id, status, expires_at)
  WHERE status IN ('pending', 'verified');

-- Index for cleanup of expired requests
CREATE INDEX idx_email_change_requests_expired
  ON email_change_requests(expires_at)
  WHERE status = 'pending';

-- RLS Policies
ALTER TABLE email_change_requests ENABLE ROW LEVEL SECURITY;

-- Users can only see their own requests
CREATE POLICY "Users can view own email change requests"
  ON email_change_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Only insert through API (no direct insert policy)
COMMENT ON TABLE email_change_requests IS
  'Stores pending email change requests with verification codes. Insert only via API.';
```

#### Migration 2: Email Change Audit Log

**File:** `supabase/migrations/YYYY-MM-DD-create-email-change-logs.sql`

```sql
-- Audit log for all email change activity
CREATE TABLE email_change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'request_created',
    'verification_sent',
    'verification_failed',
    'verification_succeeded',
    'email_updated',
    'xero_sync_succeeded',
    'xero_sync_failed',
    'request_expired',
    'request_cancelled'
  )),
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for user audit history
CREATE INDEX idx_email_change_logs_user_created
  ON email_change_logs(user_id, created_at DESC);

-- Index for monitoring failed attempts
CREATE INDEX idx_email_change_logs_failures
  ON email_change_logs(event_type, created_at DESC)
  WHERE event_type LIKE '%failed%';

-- RLS Policies
ALTER TABLE email_change_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own logs
CREATE POLICY "Users can view own email change logs"
  ON email_change_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can view all logs
CREATE POLICY "Admins can view all email change logs"
  ON email_change_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

COMMENT ON TABLE email_change_logs IS
  'Audit trail for all email change activity. Append-only via API.';
```

---

### Phase 2: Backend API Implementation

#### Endpoint 1: Request Email Change

**File:** `src/app/api/user/email/request-change/route.ts`

**Responsibilities:**
1. Validate user is authenticated and session is fresh (< 5 min)
2. Validate new email format
3. Check if new email already exists (but don't reveal to user)
4. Check rate limiting (max 3 attempts per hour)
5. Generate secure 6-digit verification code
6. Store request in `email_change_requests` table
7. Send verification email to new address
8. Send security alert to old address
9. Log event to `email_change_logs`

**Request Body:**
```typescript
{
  newEmail: string
}
```

**Response (always 200 for anti-enumeration):**
```typescript
{
  success: true,
  message: "If the email address is available, a verification code has been sent to it."
}
```

**Security Considerations:**
- Always return same message regardless of whether email exists
- Rate limit: 3 requests per user per hour
- Verification code: 6 digits, cryptographically random
- Code expires in 15 minutes
- Cancel any existing pending requests for this user
- Check authentication timestamp from Supabase session metadata

#### Endpoint 2: Confirm Email Change

**File:** `src/app/api/user/email/confirm-change/route.ts`

**Responsibilities:**
1. Validate user is authenticated
2. Find active email change request for user
3. Verify code matches (constant-time comparison)
4. Check code hasn't expired
5. Update email in both `auth.users` and `users` table (transaction)
6. Mark request as completed
7. Sync to Xero contact (non-blocking, log errors)
8. Send confirmation emails to both old and new addresses
9. Log all events to `email_change_logs`

**Request Body:**
```typescript
{
  verificationCode: string
}
```

**Response:**
```typescript
// Success
{
  success: true,
  message: "Email address updated successfully"
}

// Invalid/expired code
{
  success: false,
  error: "Invalid or expired verification code"
}
```

**Implementation Notes:**
- Use database transaction for atomic updates
- Update `auth.users` via Supabase Admin client: `supabase.auth.admin.updateUserById()`
- Update `users` table via standard Supabase client
- Xero sync failure should log error but not fail the request
- Invalidate any cached user data after successful change

**Error Handling:**
- If Supabase auth update fails, rollback database transaction
- If database update fails, attempt to rollback auth update (best effort)
- Always log failures to `email_change_logs`

---

### Phase 3: Frontend Implementation

#### Component 1: Re-authentication Modal

**File:** `src/components/modals/ReauthenticationModal.tsx`

**Purpose:** Prompts user to verify their identity via magic link before email change

**Props:**
```typescript
interface ReauthenticationModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  userEmail: string
}
```

**Flow:**
1. Display message: "For your security, please verify your identity before changing your email address."
2. Show button: "Send verification link to {userEmail}"
3. On click, send magic link via Supabase Auth
4. Display: "Check your email and click the link. Once verified, you can return here to change your email."
5. After user clicks magic link and returns, close modal and call `onSuccess()`

**Implementation:**
```typescript
const handleSendMagicLink = async () => {
  const supabase = createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: userEmail,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/user/account?reauthenticated=true`
    }
  })

  if (error) {
    toast.error('Failed to send verification link')
  } else {
    setLinkSent(true)
    toast.success('Verification link sent! Check your email.')
  }
}
```

#### Component 2: Email Change Modal

**File:** `src/components/modals/EmailChangeModal.tsx`

**Purpose:** Two-step modal for requesting and confirming email change

**Props:**
```typescript
interface EmailChangeModalProps {
  isOpen: boolean
  onClose: () => void
  currentEmail: string
  onSuccess: () => void
}
```

**State Management:**
```typescript
const [step, setStep] = useState<'request' | 'verify'>('request')
const [newEmail, setNewEmail] = useState('')
const [verificationCode, setVerificationCode] = useState('')
const [isLoading, setIsLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
```

**Step 1: Request Change**
- Email input field for new email
- Validation: email format, not same as current
- Button: "Send Verification Code"
- On success, transition to step 2

**Step 2: Verify Code**
- Display: "Enter the 6-digit code sent to {newEmail}"
- 6-digit code input (styled as separate boxes)
- Button: "Confirm Email Change"
- Link: "Didn't receive code? Resend" (respects rate limiting)
- On success, close modal and call `onSuccess()`

**API Integration:**
```typescript
const handleRequestChange = async () => {
  setIsLoading(true)
  setError(null)

  const response = await fetch('/api/user/email/request-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newEmail })
  })

  const data = await response.json()

  if (response.ok) {
    setStep('verify')
    toast.success('Verification code sent! Check your email.')
  } else {
    setError(data.error || 'Failed to send verification code')
  }

  setIsLoading(false)
}

const handleConfirmChange = async () => {
  setIsLoading(true)
  setError(null)

  const response = await fetch('/api/user/email/confirm-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationCode })
  })

  const data = await response.json()

  if (response.ok) {
    toast.success('Email address updated successfully!')
    onSuccess()
    onClose()
  } else {
    setError(data.error || 'Invalid verification code')
  }

  setIsLoading(false)
}
```

#### Update: Account Page

**File:** `src/app/(user)/user/account/page.tsx`

**Changes:**

1. Remove read-only message about contacting support
2. Add "Change Email" button next to email display
3. Add session freshness check
4. Integrate both modals

**Implementation:**
```typescript
const [showReauthModal, setShowReauthModal] = useState(false)
const [showEmailChangeModal, setShowEmailChangeModal] = useState(false)

const handleChangeEmailClick = async () => {
  // Check session freshness
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    toast.error('Please log in to change your email')
    return
  }

  // Check if session is fresh (< 5 minutes)
  const sessionAge = Date.now() - new Date(session.created_at).getTime()
  const FIVE_MINUTES = 5 * 60 * 1000

  if (sessionAge > FIVE_MINUTES) {
    // Require re-authentication
    setShowReauthModal(true)
  } else {
    // Session is fresh, proceed to email change
    setShowEmailChangeModal(true)
  }
}

const handleReauthSuccess = () => {
  setShowReauthModal(false)
  setShowEmailChangeModal(true)
}

const handleEmailChangeSuccess = async () => {
  // Refresh user data
  await fetchUserData()
  // Refresh the page to ensure all UI reflects new email
  window.location.reload()
}
```

**UI Changes:**
```tsx
{/* Email field - before */}
<div className="text-sm text-gray-500">
  Email address cannot be changed. Contact support if you need to update your email.
</div>

{/* Email field - after */}
<div className="flex items-center justify-between">
  <div className="text-sm text-gray-700">{user.email}</div>
  <button
    onClick={handleChangeEmailClick}
    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
  >
    Change Email
  </button>
</div>

{/* Add modals */}
<ReauthenticationModal
  isOpen={showReauthModal}
  onClose={() => setShowReauthModal(false)}
  onSuccess={handleReauthSuccess}
  userEmail={user.email}
/>
<EmailChangeModal
  isOpen={showEmailChangeModal}
  onClose={() => setShowEmailChangeModal(false)}
  currentEmail={user.email}
  onSuccess={handleEmailChangeSuccess}
/>
```

---

### Phase 4: Email Template Integration

#### Email Templates (Loops.so)

**Template 1: email_change_verification**

**Subject:** Verify your new email address

**Body:**
```
Hi {{firstName}},

You requested to change your email address for your membership account.

Your verification code is: {{verificationCode}}

This code will expire in 15 minutes.

If you didn't request this change, please ignore this email and contact support immediately.

---
{{organizationName}}
```

**Variables:**
- `firstName` - User's first name
- `verificationCode` - 6-digit code
- `organizationName` - From environment config

---

**Template 2: email_change_security_alert**

**Subject:** Email change requested for your account

**Body:**
```
Hi {{firstName}},

Someone requested to change the email address associated with your membership account from {{oldEmail}} to {{newEmail}}.

If this was you, no action is needed. You'll need to verify the new email address to complete the change.

If this wasn't you, please secure your account immediately:
1. Change your password (if applicable)
2. Contact support at {{supportEmail}}

---
{{organizationName}}
```

**Variables:**
- `firstName` - User's first name
- `oldEmail` - Current email address
- `newEmail` - Requested new email
- `supportEmail` - Support contact
- `organizationName` - From environment config

---

**Template 3: email_change_confirmed**

**Subject:** Your email address has been updated

**Body:**
```
Hi {{firstName}},

Your email address has been successfully updated from {{oldEmail}} to {{newEmail}}.

You'll now use {{newEmail}} to sign in to your account.

If you didn't make this change, please contact support immediately at {{supportEmail}}.

---
{{organizationName}}
```

**Variables:**
- `firstName` - User's first name
- `oldEmail` - Previous email address
- `newEmail` - New email address
- `supportEmail` - Support contact
- `organizationName` - From environment config

---

#### Email Service Integration

**File:** `src/lib/email/service.ts` (update existing)

Add new functions:

```typescript
export async function sendEmailChangeVerification(
  email: string,
  firstName: string,
  verificationCode: string
) {
  await sendTransactionalEmail({
    to: email,
    templateId: process.env.LOOPS_EMAIL_CHANGE_VERIFICATION_TEMPLATE_ID!,
    variables: {
      firstName,
      verificationCode,
      organizationName: 'Membership System'
    }
  })

  await logEmailEvent({
    type: 'email_change_verification',
    recipient: email,
    metadata: { codeLength: verificationCode.length }
  })
}

export async function sendEmailChangeSecurityAlert(
  email: string,
  firstName: string,
  oldEmail: string,
  newEmail: string
) {
  await sendTransactionalEmail({
    to: email,
    templateId: process.env.LOOPS_EMAIL_CHANGE_SECURITY_ALERT_TEMPLATE_ID!,
    variables: {
      firstName,
      oldEmail,
      newEmail,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
      organizationName: 'Membership System'
    }
  })

  await logEmailEvent({
    type: 'email_change_security_alert',
    recipient: email,
    metadata: { oldEmail, newEmail }
  })
}

export async function sendEmailChangeConfirmation(
  email: string,
  firstName: string,
  oldEmail: string,
  newEmail: string
) {
  await sendTransactionalEmail({
    to: email,
    templateId: process.env.LOOPS_EMAIL_CHANGE_CONFIRMED_TEMPLATE_ID!,
    variables: {
      firstName,
      oldEmail,
      newEmail,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
      organizationName: 'Membership System'
    }
  })

  await logEmailEvent({
    type: 'email_change_confirmed',
    recipient: email,
    metadata: { oldEmail, newEmail }
  })
}
```

**Environment Variables:**

Add to `.env.local`:
```
LOOPS_EMAIL_CHANGE_VERIFICATION_TEMPLATE_ID=clxxx...
LOOPS_EMAIL_CHANGE_SECURITY_ALERT_TEMPLATE_ID=clxxx...
LOOPS_EMAIL_CHANGE_CONFIRMED_TEMPLATE_ID=clxxx...
```

---

### Phase 5: Xero Integration

**File:** `src/lib/xero/contacts.ts` (update existing)

Add email change sync function:

```typescript
/**
 * Updates Xero contact email address after user email change
 * Non-blocking: logs errors but doesn't throw
 */
export async function syncEmailChangeToXero(
  userId: string,
  oldEmail: string,
  newEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { getActiveTenant } = await import('@/lib/xero/client')
    const activeTenant = await getActiveTenant()

    if (!activeTenant) {
      throw new Error('No active Xero tenant')
    }

    // Get user data for contact sync
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      throw new Error('User not found')
    }

    // Use existing syncUserToXeroContact which will update the contact
    await syncUserToXeroContact(userId, activeTenant.tenantId, {
      email: newEmail,
      first_name: user.first_name,
      last_name: user.last_name,
      member_id: user.member_id
    })

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Log error to Sentry but don't throw
    console.error('Failed to sync email change to Xero:', errorMessage)
    if (typeof window === 'undefined') {
      const Sentry = await import('@sentry/nextjs')
      Sentry.captureException(error, {
        tags: { context: 'xero_email_sync' },
        extra: { userId, oldEmail, newEmail }
      })
    }

    return { success: false, error: errorMessage }
  }
}
```

**Usage in confirm-change endpoint:**

```typescript
// After successful email update in database
try {
  const xeroResult = await syncEmailChangeToXero(userId, oldEmail, newEmail)

  // Log result to email_change_logs
  await logEmailChangeEvent({
    userId,
    oldEmail,
    newEmail,
    eventType: xeroResult.success ? 'xero_sync_succeeded' : 'xero_sync_failed',
    metadata: xeroResult.error ? { error: xeroResult.error } : {}
  })
} catch (error) {
  // Already logged in syncEmailChangeToXero, just continue
  console.error('Xero sync error:', error)
}
```

---

## Security Considerations

### 1. Anti-Enumeration

**Problem:** Attackers could discover which emails are registered by trying to change to various email addresses.

**Solution:**
- Always return the same success message: "If the email address is available, a verification code has been sent to it."
- Use constant-time comparison for verification codes
- No different behavior/timing for existing vs. non-existing emails

### 2. Rate Limiting

**Implementation:**

```typescript
// In request-change endpoint
async function checkRateLimit(userId: string): Promise<boolean> {
  const supabase = createClient()

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const { count, error } = await supabase
    .from('email_change_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'request_created')
    .gte('created_at', oneHourAgo.toISOString())

  if (error) throw error

  return (count ?? 0) < 3
}
```

**Response when rate limited:**
- Return same generic message (for anti-enumeration)
- Log rate limit event
- Don't reveal to user how many attempts they have left

### 3. Session Freshness

**Implementation:**

```typescript
// Check session age
function isSessionFresh(session: Session): boolean {
  const sessionAge = Date.now() - new Date(session.created_at).getTime()
  const FIVE_MINUTES = 5 * 60 * 1000
  return sessionAge < FIVE_MINUTES
}

// In both API endpoints
const { data: { session } } = await supabase.auth.getSession()
if (!session || !isSessionFresh(session)) {
  return NextResponse.json(
    { error: 'Please re-authenticate to continue' },
    { status: 401 }
  )
}
```

### 4. Verification Code Security

**Requirements:**
- Cryptographically random
- 6 digits (1 million possibilities)
- Expires in 15 minutes
- One-time use only
- Constant-time comparison

**Implementation:**

```typescript
import { randomInt } from 'crypto'

function generateVerificationCode(): string {
  // Generate cryptographically secure random 6-digit code
  const code = randomInt(0, 1000000).toString().padStart(6, '0')
  return code
}

function verifyCode(provided: string, stored: string): boolean {
  // Constant-time comparison to prevent timing attacks
  if (provided.length !== stored.length) return false

  let result = 0
  for (let i = 0; i < provided.length; i++) {
    result |= provided.charCodeAt(i) ^ stored.charCodeAt(i)
  }
  return result === 0
}
```

### 5. Atomic Updates

**Problem:** Email must be updated in both `auth.users` and `users` table. Partial updates could leave the system in an inconsistent state.

**Solution:**

```typescript
// Use database transaction for atomic updates
const supabase = createClient()

try {
  // Start transaction
  const { data, error: txError } = await supabase.rpc('begin_transaction')

  // Update Supabase Auth (outside transaction, but do first)
  const { error: authError } = await supabase.auth.admin.updateUserById(
    userId,
    { email: newEmail }
  )

  if (authError) {
    throw new Error(`Auth update failed: ${authError.message}`)
  }

  // Update users table
  const { error: dbError } = await supabase
    .from('users')
    .update({ email: newEmail, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (dbError) {
    // Rollback auth change (best effort)
    await supabase.auth.admin.updateUserById(userId, { email: oldEmail })
    throw new Error(`Database update failed: ${dbError.message}`)
  }

  // Commit transaction
  await supabase.rpc('commit_transaction')

} catch (error) {
  // Rollback transaction
  await supabase.rpc('rollback_transaction')
  throw error
}
```

---

## Testing Strategy

### Unit Tests

**API Endpoints:**
- ✅ Request change with invalid email format
- ✅ Request change when rate limited
- ✅ Request change with stale session
- ✅ Request change to existing email (verify no enumeration)
- ✅ Confirm change with invalid code
- ✅ Confirm change with expired code
- ✅ Confirm change with valid code
- ✅ Verify atomic updates (rollback on failure)

**Frontend Components:**
- ✅ Re-authentication modal flow
- ✅ Email change modal step transitions
- ✅ Form validation
- ✅ Error handling and display
- ✅ Success state and callbacks

### Integration Tests

- ✅ Full email change flow (request → verify → confirm)
- ✅ Session freshness check triggers re-authentication
- ✅ Re-authentication refreshes session and allows email change
- ✅ Email notifications sent at each step
- ✅ Xero contact sync after email change
- ✅ Audit log entries created

### Manual Testing Checklist

**Happy Path:**
- [ ] User with fresh session can change email immediately
- [ ] User with stale session is prompted to re-authenticate
- [ ] Re-authentication via magic link refreshes session
- [ ] Verification code email received at new address
- [ ] Security alert email received at old address
- [ ] Verification code works correctly
- [ ] Email updated in Supabase Auth
- [ ] Email updated in users table
- [ ] Xero contact email updated
- [ ] Confirmation emails sent to both addresses
- [ ] User can log in with new email

**Error Cases:**
- [ ] Invalid email format rejected
- [ ] Attempting to change to same email rejected
- [ ] Rate limiting after 3 attempts
- [ ] Expired verification code rejected
- [ ] Invalid verification code rejected
- [ ] Generic error messages (no enumeration)

**Security:**
- [ ] Cannot discover if email exists by trying to change to it
- [ ] Session freshness enforced
- [ ] Verification code expires after 15 minutes
- [ ] Code cannot be reused after successful verification
- [ ] All events logged to audit table

**Edge Cases:**
- [ ] Xero sync failure doesn't block email change
- [ ] Concurrent email change requests handled correctly
- [ ] User deletes account with pending email change
- [ ] Network errors during email send
- [ ] User closes modal mid-flow and restarts

---

## Monitoring & Observability

### Metrics to Track

1. **Success Rate**: % of email changes that complete successfully
2. **Failure Reasons**: Categorize why email changes fail
3. **Time to Complete**: From request to confirmation
4. **Re-authentication Rate**: % of users who need to re-auth
5. **Xero Sync Success**: % of Xero syncs that succeed
6. **Rate Limit Hits**: How often users hit rate limits

### Logging

**Key Events to Log:**
- `request_created` - Email change requested
- `verification_sent` - Verification code sent
- `verification_failed` - Invalid/expired code entered
- `verification_succeeded` - Valid code entered
- `email_updated` - Email successfully changed
- `xero_sync_succeeded` - Xero contact updated
- `xero_sync_failed` - Xero sync failed (with error)
- `request_expired` - Verification code expired
- `rate_limit_hit` - User hit rate limit

**Log Fields:**
- `user_id` - User making the change
- `old_email` - Current email
- `new_email` - Requested email (if applicable)
- `ip_address` - Request IP
- `user_agent` - Browser/device info
- `metadata` - Event-specific data (errors, timing, etc.)

### Alerts

**Critical:**
- Email send failures > 5% (Loops.so integration issue)
- Supabase Auth update failures > 1%
- Database update failures > 0.1%

**Warning:**
- Xero sync failures > 10%
- Rate limit hits > 50 per day (possible abuse)
- Verification codes expiring without attempt (UX issue)

---

## Deployment Plan

### Pre-Deployment

1. **Environment Setup:**
   - [ ] Create Loops.so email templates
   - [ ] Add template IDs to `.env.local` and production env vars
   - [ ] Verify Supabase Admin client has `auth.admin.updateUserById` permission

2. **Database Migrations:**
   - [ ] Run migration to create `email_change_requests` table
   - [ ] Run migration to create `email_change_logs` table
   - [ ] Verify RLS policies are active

### Deployment Steps

1. **Deploy Backend (API endpoints)**
   - Deploy to staging first
   - Run integration tests
   - Monitor error rates

2. **Deploy Frontend (modals and account page)**
   - Deploy to staging
   - Test full flow end-to-end
   - Verify email delivery

3. **Production Deployment**
   - Deploy during low-traffic window
   - Monitor error logs and Sentry
   - Check email delivery rates
   - Verify Xero sync success rate

### Post-Deployment

1. **Monitoring (first 24 hours):**
   - [ ] Check email delivery success rate
   - [ ] Monitor API error rates
   - [ ] Review Sentry for any new errors
   - [ ] Verify Xero sync success rate

2. **User Communication:**
   - [ ] Update help docs to explain email change process
   - [ ] Notify users of new feature (optional)

### Rollback Plan

If critical issues arise:

1. **Disable Feature:**
   - Revert account page changes (remove "Change Email" button)
   - Keep API endpoints live (for in-progress requests)
   - Show message: "Email change temporarily unavailable"

2. **Database Cleanup:**
   - Cancel all pending email change requests
   - Notify users via old email if changes were in progress

---

## Future Enhancements

### Phase 2 (Nice to Have)

1. **Email Change History**
   - Show users their email change history on account page
   - Include timestamps and status

2. **Admin Override**
   - Allow admins to change user emails directly
   - Bypass verification for admin-initiated changes
   - Notify user of admin change

3. **Bulk Email Updates**
   - Admin tool to update multiple emails from CSV
   - Useful for data migrations or corrections

4. **Email Verification Status**
   - Track whether users have verified their email
   - Send reminder if email not verified after X days

5. **Alternative Verification Methods**
   - SMS verification code option
   - TOTP (authenticator app) option

---

## Open Questions

- [ ] What should the support contact email be for email templates?
- [ ] Should we add a cooldown period (e.g., 7 days) between email changes?
- [ ] Do we need to notify admins when users change emails?
- [ ] Should we prevent changing to emails from disposable email providers?

---

## References

### Related Files
- `/src/app/(user)/user/account/page.tsx` - Account display page
- `/src/app/(user)/user/account/edit/page.tsx` - Profile edit page (name/phone changes)
- `/src/lib/supabase/client.ts` - Supabase client setup
- `/src/lib/supabase/admin.ts` - Admin client for auth updates
- `/src/lib/xero/contacts.ts` - Xero contact sync logic
- `/src/lib/email/service.ts` - Email sending via Loops.so

### External Documentation
- [Supabase Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-api)
- [Loops.so Transactional Emails](https://loops.so/docs/transactional-emails)
- [Xero Contacts API](https://developer.xero.com/documentation/api/accounting/contacts)

---

**Last Updated:** 2025-11-17
**Author:** Development Team
**Status:** Ready for Implementation
