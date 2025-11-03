# Payment Plans for Registrations

## Overview
Implement a payment plan system for registrations that allows admins to enable users for installment payments, with automated payment processing and notifications.

## Business Requirements

### Admin Control
- Admins can enable/disable payment plan eligibility for individual users
- Payment plan option only appears for enabled users during registration checkout
- Disabling a user's payment plan eligibility prevents NEW payment plans but doesn't affect ongoing ones
- Admin dashboard shows all users with payment plan eligibility and current balances

### User Experience
- Users must have a saved payment method to use payment plans
- Users cannot remove their payment method while they have an outstanding payment plan balance
- Users can pay down remaining balance early if desired
- Payment plan option appears during registration checkout (only for enabled users)

### Payment Structure
- Single plan type: 4 monthly payments of 25% each
- Option to pay first payment immediately or in one month
- Automatic processing via daily cron job
- Email notifications before and after each payment

## Database Schema Changes

### 1. Add Payment Plan Flag to Users Table
```sql
ALTER TABLE users ADD COLUMN payment_plan_enabled BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_users_payment_plan_enabled ON users(payment_plan_enabled) WHERE payment_plan_enabled = true;
```

### 2. Create Payment Plans Table
```sql
CREATE TABLE payment_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_registration_id UUID NOT NULL REFERENCES user_registrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount INTEGER NOT NULL, -- in cents
    paid_amount INTEGER DEFAULT 0, -- in cents
    installment_amount INTEGER NOT NULL, -- 25% of total (in cents)
    installments_count INTEGER DEFAULT 4,
    installments_paid INTEGER DEFAULT 0,
    next_payment_date DATE NOT NULL,
    first_payment_immediate BOOLEAN DEFAULT false,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
    xero_invoice_id UUID REFERENCES xero_invoices(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payment_plans_user_id ON payment_plans(user_id);
CREATE INDEX idx_payment_plans_user_registration_id ON payment_plans(user_registration_id);
CREATE INDEX idx_payment_plans_status ON payment_plans(status);
CREATE INDEX idx_payment_plans_next_payment_date ON payment_plans(next_payment_date) WHERE status = 'active';

-- Ensure one payment plan per registration
ALTER TABLE payment_plans ADD CONSTRAINT unique_payment_plan_per_registration UNIQUE(user_registration_id);
```

### 3. Create Payment Plan Transactions Table
```sql
CREATE TABLE payment_plan_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_plan_id UUID NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL, -- in cents
    installment_number INTEGER NOT NULL,
    scheduled_date DATE NOT NULL,
    processed_date TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    failure_reason TEXT,
    stripe_payment_intent_id TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payment_plan_transactions_payment_plan_id ON payment_plan_transactions(payment_plan_id);
CREATE INDEX idx_payment_plan_transactions_status ON payment_plan_transactions(status);
CREATE INDEX idx_payment_plan_transactions_scheduled_date ON payment_plan_transactions(scheduled_date) WHERE status = 'pending';
CREATE INDEX idx_payment_plan_transactions_stripe_payment_intent_id ON payment_plan_transactions(stripe_payment_intent_id);

-- Ensure installment numbers are unique per payment plan
ALTER TABLE payment_plan_transactions ADD CONSTRAINT unique_installment_per_plan UNIQUE(payment_plan_id, installment_number);
```

### 4. Add Updated At Triggers
```sql
CREATE TRIGGER update_payment_plans_updated_at 
    BEFORE UPDATE ON payment_plans 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_plan_transactions_updated_at 
    BEFORE UPDATE ON payment_plan_transactions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
```

## Frontend Changes

### 1. Admin Dashboard Updates
- Add "Payment Plans" section to admin dashboard
- Show table of users enabled for payment plans with:
  - User name and email
  - Current active payment plan count
  - Total outstanding balance
  - Next payment date (if applicable)
- Filter and search functionality
- Link to individual user detail pages

### 2. User Detail Page Updates (`/admin/reports/users/[id]`)
- Add toggle switch for payment plan eligibility
  - Can be toggled even with active payment plans
  - Show warning when disabling with active plans
- Add "Payment Plans" section showing:
  - List of all payment plans (active, completed, cancelled)
  - For each plan: registration details, payment schedule, status
  - Transaction history for each payment plan
- Show "Payment Plan" tag on invoices instead of "Paid/Unpaid" when applicable
- Add option to manually trigger payment or cancel payment plan

### 3. Registration Flow Updates
- Add payment plan option during checkout (only for enabled users)
- Validate saved payment method exists before showing option
- Show payment schedule preview (4 payments of X amount)
- Option to start payments immediately or in one month
- Clear terms and conditions for payment plan agreement

### 4. User Account/Payment Methods Page
- Prevent removal of payment method when active payment plan balance exists
- Show warning message about payment plan dependency
- Add "Pay Remaining Balance" button for early payoff of active plans
- Display current payment plan status and next payment date

## Backend Implementation

### 1. Payment Plan Service (`src/lib/services/payment-plan-service.ts`)
```typescript
class PaymentPlanService {
  // Create payment plan during registration
  createPaymentPlan(registrationId: string, userId: string, totalAmount: number, firstPaymentImmediate: boolean)
  
  // Process scheduled payments (called by cron)
  processScheduledPayments()
  
  // Handle individual payment processing
  processPaymentPlanPayment(transactionId: string)
  
  // Calculate next payment date
  calculateNextPaymentDate(paymentPlan: PaymentPlan): Date
  
  // Check if user can create new payment plan
  canUserCreatePaymentPlan(userId: string): boolean
  
  // Handle early payoff
  processEarlyPayoff(paymentPlanId: string, paymentMethodId: string)
  
  // Cancel payment plan
  cancelPaymentPlan(paymentPlanId: string, reason: string)
}
```

### 2. Registration Payment Intent Updates
- Modify `/api/create-registration-payment-intent` to handle payment plan creation
- Create payment plan record when payment plan option is selected
- Handle first payment processing (immediate or scheduled)
- Stage Xero invoice for full amount with payment plan indicator

### 3. Stripe Integration Updates
- Extend `/api/stripe-webhook` to handle payment plan transactions
- Use saved payment methods for recurring charges via `stripe.paymentIntents.create()`
- Link payment plan transaction IDs to Stripe payment intents in metadata
- Handle payment failures with proper error handling and notifications

### 4. Xero Integration Updates
- Modify invoice staging to handle payment plan invoices
- Mark initial invoice as "payment_plan" type in line items or description
- Record partial payments against the original invoice as they come in
- Update invoice status tracking for partial vs. full payment

### 5. Payment Method Service Updates
- Add validation to prevent payment method removal with outstanding balance
- Extend `getUserSavedPaymentMethodId()` to validate payment method status
- Add `hasOutstandingPaymentPlanBalance(userId: string): boolean`

### 6. Cron Job Implementation (`src/app/api/cron/payment-plans/route.ts`)
```typescript
// Daily cron job to process due payments
export async function GET(request: NextRequest) {
  // Verify cron authorization
  // Find all pending transactions due today or overdue
  // Process each payment using saved payment methods
  // Handle failures and send notifications
  // Update payment plan status and next payment dates
  // Send pre-notifications for payments due in 3 days
}
```

## Email Notifications

### 1. New Email Event Types
```typescript
export const EMAIL_EVENTS = {
  // ... existing events
  PAYMENT_PLAN_PRE_NOTIFICATION: 'payment_plan.pre_notification',
  PAYMENT_PLAN_PAYMENT_PROCESSED: 'payment_plan.payment_processed',
  PAYMENT_PLAN_PAYMENT_FAILED: 'payment_plan.payment_failed',
  PAYMENT_PLAN_COMPLETED: 'payment_plan.completed',
} as const
```

### 2. Loops Email Templates
- **Pre-notification** (sent 3 days before charge): Upcoming payment reminder
- **Payment processed**: Successful payment confirmation with remaining balance
- **Payment failed**: Failed payment notification with retry information
- **Payment plan completed**: Final payment processed, plan complete

### 3. Template Data Variables
```typescript
interface PaymentPlanEmailData {
  user_name: string
  installment_number: number
  installment_amount: string // formatted currency
  remaining_balance: string // formatted currency
  next_payment_date: string // formatted date
  registration_name: string
  total_installments: number
  payment_date: string // formatted date (for processed emails)
}
```

## Implementation Order

### Phase 1: Database Foundation
1. Create migration for payment plan tables
2. Add payment_plan_enabled flag to users table
3. Add necessary indexes and constraints

### Phase 2: Backend Services
1. Implement PaymentPlanService core functionality
2. Update registration payment intent creation
3. Extend Stripe webhook handler for payment plans
4. Update Xero integration for payment plan invoices

### Phase 3: Admin Interface
1. Add payment plan toggle to user detail page
2. Create payment plan management dashboard
3. Update invoice display logic for payment plan tags
4. Add payment plan transaction history views

### Phase 4: User Interface
1. Add payment plan option to registration checkout
2. Update payment method management to prevent removal
3. Add early payoff functionality
4. Add payment plan status display

### Phase 5: Automation
1. Implement daily payment processing cron job
2. Create email notification system
3. Add failure handling and retry logic
4. Implement pre-notification system

### Phase 6: Testing & Deployment
1. End-to-end testing of complete payment plan workflow
2. Test failure scenarios and edge cases
3. Verify Xero integration accuracy
4. Monitor email delivery and cron job performance

## Edge Cases & Considerations

### Payment Failures
- Retry failed payments up to 3 times over 7 days
- Send notifications after each failure
- Escalate to admin after final failure
- Option to manually retry or cancel plan

### User Account Deletion
- Handle payment plans when user deletes account
- Transfer outstanding balance to admin for collection
- Maintain payment plan records for accounting

### Xero Synchronization
- Ensure proper invoice and payment tracking
- Handle Xero API failures gracefully
- Maintain audit trail for all payment plan transactions

### Refunds
- Handle refunds for payment plan payments
- Adjust remaining balance and schedule accordingly
- Update Xero records with credit notes

## Success Metrics
- Number of users enabled for payment plans
- Payment plan adoption rate during registration
- Payment success rate for automated charges
- Time to payment plan completion
- Customer satisfaction with payment plan experience

## Future Enhancements
- Multiple payment plan options (3, 6, 12 months)
- Variable payment amounts (e.g., 50% upfront, 25%, 25%)
- Payment plan for memberships (not just registrations)
- Integration with external payment plan providers
- Payment plan analytics and reporting dashboard