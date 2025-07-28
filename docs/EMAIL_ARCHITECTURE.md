# Email Architecture

## Overview

The membership system uses a centralized email architecture to prevent duplicate emails and ensure consistent delivery. All membership and registration confirmation emails are handled exclusively through the **EmailProcessor** class, which is coordinated by the **Payment Completion Processor**.

## File Structure

All email-related functionality is organized in the `src/lib/email/` folder:

```
src/lib/email/
├── index.ts          # Centralized exports
├── processor.ts      # Email processing for payment completion
├── service.ts        # Email integration service (Loops.so)
└── staging.ts        # Email staging and batch processing
```

## Email Flow

### 1. Membership & Registration Confirmation Emails

**ONLY** sent through the EmailProcessor (`src/lib/email/processor.ts`) which is coordinated by the Payment Completion Processor:

#### Zero-Dollar Purchases (Free)
- **Trigger**: Immediate completion of free membership/registration
- **Source**: `free_membership` or `free_registration`
- **Timing**: Email sent immediately when purchase completes
- **Location**: `src/app/api/create-payment-intent/route.ts` and `src/app/api/create-registration-payment-intent/route.ts`

#### Paid Purchases
- **Trigger**: Stripe webhook payment completion
- **Source**: `stripe_webhook_membership` or `stripe_webhook_registration`
- **Timing**: Email sent when payment succeeds
- **Location**: `src/app/api/stripe-webhook/route.ts`

### 2. Other Email Types

#### Waitlist Emails
- **Trigger**: User joins waitlist
- **Location**: `src/app/api/join-waitlist/route.ts`
- **Reason**: Not payment-related, sent directly

#### Welcome Emails
- **Trigger**: New user account creation
- **Location**: Various onboarding flows
- **Reason**: Account-related, not payment-related

#### Payment Failure Emails
- **Trigger**: Payment processing fails
- **Location**: Payment Completion Processor (failed payment flow)
- **Reason**: Payment-related, handled centrally

## Email Staging System

All emails go through the email staging system (`src/lib/email/staging.ts`) which:

1. **Stages emails** for batch processing (default behavior)
2. **Sends immediately** when `isImmediate: true` is specified
3. **Logs all emails** to the `email_logs` table for tracking
4. **Handles retries** and error recovery

## Preventing Duplicate Emails

### 1. Single Source of Truth
- **EmailProcessor** is the ONLY place where membership/registration confirmation emails are sent
- Payment Completion Processor orchestrates the flow and delegates to EmailProcessor
- All other code paths have been removed or updated to use the processor

### 2. Clear Trigger Sources
- `free_membership` / `free_registration`: Zero-dollar purchases
- `stripe_webhook_membership` / `stripe_webhook_registration`: Paid purchases
- Each trigger source is handled exactly once

### 3. Email Staging with Deduplication
- Emails are staged with related entity information
- System can track which emails have been sent for which purchases
- Batch processing prevents duplicate sends

## Code Architecture

### Payment Completion Processor
```typescript
// Main orchestrator for payment completion flow
async processPaymentCompletion(event: PaymentCompletionEvent) {
  // Phase 1: Handle Xero staging records
  await this.handleXeroStagingRecords(event)
  
  // Phase 2: Process confirmation emails (delegated to EmailProcessor)
  await emailProcessor.processConfirmationEmails(event)
  
  // Phase 3: Process staged emails immediately (delegated to EmailProcessor)
  await emailProcessor.processStagedEmails()
  
  // Phase 4: Sync pending Xero records
  await this.syncPendingXeroRecords()
  
  // Phase 5: Update discount usage tracking
  await this.updateDiscountUsage(event)
}
```

### EmailProcessor (`src/lib/email/processor.ts`)
```typescript
// Dedicated email processing class
class EmailProcessor {
  async processConfirmationEmails(event: PaymentCompletionEvent)
  async sendFailedPaymentEmails(event: PaymentCompletionEvent)
  async processStagedEmails()
  private async stageMembershipConfirmationEmail(event, user)
  private async stageRegistrationConfirmationEmail(event, user)
}
```

### EmailService (`src/lib/email/service.ts`)
```typescript
// Email integration service (Loops.so)
class EmailService {
  async sendMembershipPurchaseConfirmation(options)
  async sendRegistrationConfirmation(options)
  async sendWaitlistAddedNotification(options)
  async sendWelcomeEmail(options)
  // ... other email methods
}
```

### EmailStagingManager (`src/lib/email/staging.ts`)
```typescript
// Centralized email staging and sending
class EmailStagingManager {
  async stageEmail(emailData: StagedEmailData, options?: EmailStagingOptions)
  async processStagedEmails()
  private async sendEmailImmediately(emailData: StagedEmailData)
}
```

## Testing Email Flow

### Test Zero-Dollar Purchase
1. Create a free membership or registration
2. Check that `paymentProcessor.processPaymentCompletion()` is called with `free_membership` or `free_registration`
3. Verify `emailProcessor.processConfirmationEmails()` is called and email is staged and sent immediately

### Test Paid Purchase
1. Complete a paid membership or registration
2. Check that Stripe webhook calls `paymentProcessor.processPaymentCompletion()` with `stripe_webhook_membership` or `stripe_webhook_registration`
3. Verify `emailProcessor.processConfirmationEmails()` is called and email is staged and sent when payment completes

### Test Payment Failure
1. Attempt a payment that fails
2. Check that `paymentProcessor.processPaymentCompletion()` is called with `failed: true`
3. Verify `emailProcessor.sendFailedPaymentEmails()` is called and failure notification email is sent

## Monitoring

### Email Logs
All emails are logged to the `email_logs` table with:
- `event_type`: Type of email (membership.purchased, registration.completed, etc.)
- `related_entity_type`: Type of related entity (user_memberships, user_registrations)
- `related_entity_id`: ID of the related entity
- `payment_id`: Associated payment ID
- `status`: Email delivery status

### Logging
The Payment Completion Processor logs all email operations with detailed context for debugging.

## Migration Notes

### Removed Code
- Legacy `sendMembershipConfirmationEmail()` method
- Legacy `sendRegistrationConfirmationEmail()` method
- Direct email service calls in payment flows
- Email-related methods from PaymentCompletionProcessor (moved to EmailProcessor)

### Preserved Code
- Waitlist email sending (not payment-related)
- Welcome email sending (account-related)
- Payment failure email sending (handled by processor)

## Future Considerations

1. **Email Templates**: All templates are managed through Loops.so
2. **Retry Logic**: Failed emails are automatically retried by the staging system
3. **Monitoring**: Email delivery status is tracked in the database
4. **Scalability**: Batch processing allows for high-volume email sending 