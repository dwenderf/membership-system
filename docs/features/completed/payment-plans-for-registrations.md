# Payment Plans for Registrations

## Overview
Implement a payment plan system for registrations that allows admins to enable users for installment payments, with automated payment processing and notifications.

**Architecture**: Payment plans are implemented using the existing `xero_payments` table with `payment_type` = 'installment', eliminating the need for separate payment plan tables and simplifying the data model.

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

## Database Schema

### 1. Add Payment Plan Flag to Users Table
```sql
ALTER TABLE users ADD COLUMN payment_plan_enabled BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_users_payment_plan_enabled ON users(payment_plan_enabled) WHERE payment_plan_enabled = true;
```

### 2. Extend xero_payments Table for Payment Plans
Payment plans use the existing `xero_payments` table with additional columns:

```sql
-- Add payment plan columns to xero_payments
ALTER TABLE xero_payments
ADD COLUMN payment_type TEXT CHECK (payment_type IN ('full', 'installment')),
ADD COLUMN installment_number INTEGER,
ADD COLUMN planned_payment_date DATE,
ADD COLUMN attempt_count INTEGER DEFAULT 0,
ADD COLUMN last_attempt_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN failure_reason TEXT;

-- Drop old UNIQUE constraint that prevented multiple payments per invoice
ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_xero_invoice_id_tenant_id_key;

-- Update sync_status to include payment plan statuses
ALTER TABLE xero_payments
DROP CONSTRAINT IF EXISTS xero_payments_sync_status_check;

ALTER TABLE xero_payments
ADD CONSTRAINT xero_payments_sync_status_check
CHECK (sync_status IN ('pending', 'staged', 'planned', 'cancelled', 'processing', 'synced', 'failed', 'ignore'));

-- Indexes for efficient payment plan queries
CREATE INDEX idx_xero_payments_planned_ready
ON xero_payments(sync_status, planned_payment_date)
WHERE sync_status = 'planned' AND planned_payment_date IS NOT NULL;

CREATE INDEX idx_xero_payments_payment_type ON xero_payments(payment_type);

CREATE INDEX idx_xero_payments_invoice_installment
ON xero_payments(xero_invoice_id, installment_number)
WHERE installment_number IS NOT NULL;
```

### 3. Add Payment Plan Flag to xero_invoices
```sql
ALTER TABLE xero_invoices
ADD COLUMN is_payment_plan BOOLEAN DEFAULT FALSE;
```

### 4. Create payment_plan_summary View
```sql
CREATE OR REPLACE VIEW payment_plan_summary
WITH (security_invoker = true)
AS
SELECT
  xi.id as invoice_id,
  (xi.staging_metadata->>'user_id')::uuid as contact_id,
  xi.payment_id as first_payment_id,
  COUNT(*) FILTER (WHERE xp.payment_type = 'installment') as total_installments,
  SUM(xp.amount_paid) FILTER (WHERE xp.sync_status IN ('synced','pending','processing')) as paid_amount,
  SUM(xp.amount_paid) as total_amount,
  MAX(xp.planned_payment_date) as final_payment_date,
  MIN(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned') as next_payment_date,
  COUNT(*) FILTER (WHERE xp.sync_status IN ('synced','pending','processing') AND xp.payment_type = 'installment') as installments_paid,
  CASE
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'planned') = 0 THEN 'completed'
    WHEN COUNT(*) FILTER (WHERE xp.sync_status = 'failed') > 0 THEN 'failed'
    ELSE 'active'
  END as status,
  json_agg(
    json_build_object(
      'id', xp.id,
      'installment_number', xp.installment_number,
      'amount', xp.amount_paid,
      'planned_payment_date', xp.planned_payment_date,
      'sync_status', xp.sync_status,
      'attempt_count', xp.attempt_count,
      'failure_reason', xp.failure_reason
    ) ORDER BY xp.installment_number
  ) as installments
FROM xero_invoices xi
JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
WHERE xi.is_payment_plan = true
GROUP BY xi.id, xi.staging_metadata, xi.payment_id;

-- Restrict access to service_role only
GRANT SELECT ON payment_plan_summary TO service_role;
```

### Payment Status Flow
- `staged` → Initial state when payment plan is created
- `pending` → First payment ready to process
- `planned` → Future payments waiting for their scheduled date
- `processing` → Currently being charged
- `synced` → Successfully synced to Xero
- `cancelled` → Superseded by early payoff
- `failed` → Payment failed after max attempts

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
  // Creates multiple xero_payments records with payment_type='installment'
  static async createPaymentPlan(data: PaymentPlanCreationData): Promise<{success: boolean, error?: string}>

  // Process individual payment from xero_payments table
  // Called by cron job for each pending/failed payment
  static async processPaymentPlanPayment(xeroPaymentId: string): Promise<{success: boolean, error?: string}>

  // Check if user can create new payment plan
  // Requires payment_plan_enabled flag AND valid saved payment method
  static async canUserCreatePaymentPlan(userId: string): Promise<boolean>

  // Handle early payoff - cancels planned payments and creates single full payment
  // Uses webhook-based flow for reliability
  static async processEarlyPayoff(xeroInvoiceId: string, userId: string): Promise<{success: boolean, error?: string}>

  // Get all payment plans for a user using payment_plan_summary view
  static async getUserPaymentPlans(userId: string): Promise<PaymentPlanSummary[]>

  // Check if user has outstanding payment plan balance
  static async hasOutstandingBalance(userId: string): Promise<boolean>

  // Get total outstanding balance across all payment plans
  static async getTotalOutstandingBalance(userId: string): Promise<number>
}
```

### 2. Payment Plan Configuration (`src/lib/services/payment-plan-config.ts`)
Centralized constants for all payment plan behavior:
```typescript
export const PAYMENT_PLAN_INSTALLMENTS = 4          // Number of payments
export const INSTALLMENT_INTERVAL_DAYS = 30         // Days between payments
export const MAX_PAYMENT_ATTEMPTS = 3               // Max retry attempts
export const RETRY_INTERVAL_HOURS = 24              // Hours between retries
```

### 3. Registration Payment Intent Updates
- Modified `/api/create-registration-payment-intent` to handle payment plan creation
- Creates multiple `xero_payments` records (all with `sync_status='staged'`)
- First payment record has `first_payment_id` in metadata linking to actual payment
- All installments created upfront with scheduled dates

### 4. Stripe Webhook Updates (`/api/stripe-webhook/route.ts`)
Extended to handle payment plan payment intents:
- After first payment completes: Updates installments from 'staged' to 'pending'/'planned'
- Helper function `updatePaymentPlanStatuses()` manages status transitions
- Early payoff webhook handler processes cancellation and single full payment
- All webhook handlers are idempotent (safe to retry)

### 5. Xero Integration
- Invoice created with full amount and `is_payment_plan=true` flag
- Each installment payment creates separate `xero_payments` record
- Payments tracked individually with proper installment_number
- Synced to Xero as partial payments against the original invoice
- Uses sentinel UUID (`00000000-0000-0000-0000-000000000000`) as placeholder until synced

### 6. Payment Method Service Updates
- Validation prevents payment method removal if `hasOutstandingBalance()` returns true
- Checks across all `xero_payments` with payment_type='installment' and status='planned'
- Returns total outstanding balance from all active payment plans

### 7. Cron Job Implementation (`src/app/api/cron/payment-plans/route.ts`)
```typescript
// Daily cron job to process due payments
export async function GET(request: NextRequest) {
  // Verify cron authorization header
  // Query xero_payments where:
  //   - sync_status = 'planned' AND planned_payment_date <= today
  //   - OR sync_status = 'failed' AND retry is due (based on RETRY_INTERVAL_HOURS)
  // Process each payment using PaymentPlanService.processPaymentPlanPayment()
  // Increment attempt_count, respect MAX_PAYMENT_ATTEMPTS limit
  // Update sync_status to 'processing' → 'pending' (on success) or 'failed' (on failure)
  // Return summary of processed payments
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

## Architecture Improvements (2025-11 Refactor)

The payment plan system was refactored from separate `payment_plans` and `payment_plan_transactions` tables to use the existing `xero_payments` table architecture. This provides several key benefits:

### Benefits
1. **Simplified Data Model**: Single source of truth for all payments (regular and installment)
2. **Consistent Payment Processing**: Same infrastructure handles both payment types
3. **Better Xero Integration**: Natural mapping to Xero's invoice + multiple payments model
4. **Reduced Code Duplication**: Shared payment processing logic and sync mechanisms
5. **Improved Query Performance**: Views aggregate data efficiently without complex joins across multiple tables

### Key Technical Decisions
1. **Dropped UNIQUE Constraint**: Removed `UNIQUE(xero_invoice_id, tenant_id)` to allow multiple payments per invoice
2. **Sentinel UUID**: Use `00000000-0000-0000-0000-000000000000` as placeholder for `xero_payment_id` until synced
3. **Status Flow**: Extended `sync_status` enum with 'staged', 'planned', and 'cancelled' states
4. **Webhook-Based Early Payoff**: Changed from synchronous to webhook-based flow for reliability
5. **Rounding Fix**: Last installment absorbs remainder to ensure exact total match (prevents penny discrepancies)
6. **Centralized Config**: All constants (installments, intervals, retry logic) in `payment-plan-config.ts`

### Migration from Old Architecture
- **Old Tables**: `payment_plans` and `payment_plan_transactions` (now dropped)
- **New Architecture**: `xero_payments` with `payment_type='installment'`
- **View**: `payment_plan_summary` aggregates payment plan data for queries
- **No Data Migration**: Development environment, fresh implementation

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