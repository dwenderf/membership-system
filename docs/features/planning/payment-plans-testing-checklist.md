# Payment Plans Testing Checklist

## Prerequisites

### Environment Setup
- [ ] Add `ADMIN_SECRET` to environment variables
- [ ] Add Loops email template IDs to environment:
  - `LOOPS_PAYMENT_PLAN_PRE_NOTIFICATION_TEMPLATE_ID`
  - `LOOPS_PAYMENT_PLAN_PAYMENT_PROCESSED_TEMPLATE_ID`
  - `LOOPS_PAYMENT_PLAN_PAYMENT_FAILED_TEMPLATE_ID`
  - `LOOPS_PAYMENT_PLAN_COMPLETED_TEMPLATE_ID`
- [ ] Verify Stripe test keys are configured
- [ ] Verify database migration applied successfully

### Test User Setup
- [ ] Create test user account
- [ ] Enable payment plan eligibility for test user:
  ```sql
  UPDATE users SET payment_plan_enabled = true WHERE email = 'test@example.com';
  ```
- [ ] Set up saved payment method via normal flow

---

## Phase 1: Database & Core Services

### Database Schema
- [ ] Verify `payment_plans` table exists
- [ ] Verify `payment_plan_transactions` table exists
- [ ] Verify `payment_plan_enabled` column on `users` table
- [ ] Verify all indexes created successfully
- [ ] Test updated_at triggers work correctly

### PaymentPlanService
- [ ] Test `canUserCreatePaymentPlan()` - checks eligibility
- [ ] Test `createPaymentPlan()` - creates plan with 4 installments
- [ ] Test `processPaymentPlanTransaction()` - processes single payment
- [ ] Test `processEarlyPayoff()` - pays remaining balance
- [ ] Test `cancelPaymentPlan()` - cancels active plan
- [ ] Test `getUserPaymentPlans()` - retrieves user plans
- [ ] Test `hasOutstandingBalance()` - checks for balance
- [ ] Test `getTotalOutstandingBalance()` - calculates total

---

## Phase 2: Admin APIs

### User Payment Plan Eligibility API
- [ ] **GET** `/api/admin/users/[id]/payment-plan-eligibility`
  - [ ] Returns current eligibility status
  - [ ] Requires admin authentication
  - [ ] Returns 401 for non-admin users
- [ ] **PUT** `/api/admin/users/[id]/payment-plan-eligibility`
  - [ ] Enables payment plans for user
  - [ ] Disables payment plans for user
  - [ ] Logs all changes
  - [ ] Returns updated user data

### User Payment Plans API
- [ ] **GET** `/api/admin/users/[id]/payment-plans`
  - [ ] Returns all plans for user
  - [ ] Includes registration details
  - [ ] Shows correct balances and progress
  - [ ] Requires admin authentication

### Payment Plans Report API
- [ ] **GET** `/api/admin/payment-plans?filter=all`
  - [ ] Returns all users
  - [ ] Includes summary statistics
  - [ ] Shows correct totals
- [ ] **GET** `/api/admin/payment-plans?filter=eligible`
  - [ ] Returns only eligible users
  - [ ] Filters correctly
- [ ] **GET** `/api/admin/payment-plans?filter=active`
  - [ ] Returns only users with balance
  - [ ] Calculates balances correctly
  - [ ] Shows next/final payment dates

---

## Phase 3: Admin UI

### User Detail Page
- [ ] Navigate to `/admin/reports/users/[id]`
- [ ] **Payment Plan Section visible**
  - [ ] Shows eligibility toggle
  - [ ] Toggle works (enable/disable)
  - [ ] Success message displays
  - [ ] Page refreshes to show new status
- [ ] **Active Payment Plans section**
  - [ ] Shows all active plans
  - [ ] Displays correct amounts
  - [ ] Shows progress (X/4 installments)
  - [ ] Displays next payment date
  - [ ] Shows remaining balance
  - [ ] Registration names display correctly

### Payment Plans Report Page
- [ ] Navigate to `/admin/reports/payment-plans`
- [ ] **Summary Cards**
  - [ ] Total Users count correct
  - [ ] With Active Plans count correct
  - [ ] With Balance Due count correct
  - [ ] Total Outstanding displays correct amount
- [ ] **Filter Buttons**
  - [ ] "All Users" filter works
  - [ ] "Eligible Only" filter works
  - [ ] "With Balance Due" filter works
  - [ ] Data updates when filter changes
- [ ] **Table Display**
  - [ ] User info displays correctly
  - [ ] Eligibility status shows (Enabled/Disabled)
  - [ ] Active plans count correct
  - [ ] Amounts display correctly
  - [ ] Next payment dates show
  - [ ] "View Details" link works
- [ ] **Expandable Rows**
  - [ ] Click to expand individual plans
  - [ ] Plan details show correctly
  - [ ] Progress bars/numbers accurate
  - [ ] Next payment dates display

---

## Phase 4: Registration Payment Flow

### Payment Intent API
- [ ] **POST** `/api/create-registration-payment-intent` with `usePaymentPlan: true`
  - [ ] Validates user eligibility
  - [ ] Returns error if not eligible
  - [ ] Calculates first installment (25% of total)
  - [ ] Creates payment intent for first installment only
  - [ ] Sets `setup_future_usage: 'off_session'`
  - [ ] Adds payment plan metadata
  - [ ] Returns payment plan info in response

### Stripe Webhook - First Payment
- [ ] Payment succeeds for first installment
- [ ] Webhook receives `payment_intent.succeeded`
- [ ] Detects `isPaymentPlan: 'true'` metadata
- [ ] Saves payment method to user profile
- [ ] Creates payment plan record
- [ ] Creates 4 transaction records (1 completed, 3 pending)
- [ ] Schedules remaining payments 30 days apart
- [ ] Links to Xero invoice
- [ ] Triggers payment completion processor
- [ ] Sends registration confirmation email

### Registration Status
- [ ] User registration status set to 'paid'
- [ ] User can access registration details
- [ ] Registration shows in user's active registrations

---

## Phase 5: Automated Payment Processing

### Daily Cron Job
- [ ] Job runs at 2:06am (or manually trigger)
- [ ] **Processing Due Payments**
  - [ ] Finds transactions due today or earlier
  - [ ] Filters by retry eligibility (24hr gap)
  - [ ] Processes each due transaction
  - [ ] Updates transaction status
  - [ ] Updates payment plan balances
  - [ ] Records payment in database
  - [ ] Links to Xero invoice
- [ ] **Sending Pre-Notifications**
  - [ ] Finds payments due in 3 days
  - [ ] Sends pre-notification emails
  - [ ] Email contains correct details
  - [ ] Placeholders filled correctly
- [ ] **Sending Completion Emails**
  - [ ] Detects when plan completed
  - [ ] Sends completion email
  - [ ] Marks plan as 'completed'
- [ ] **Error Handling**
  - [ ] Failed payments logged correctly
  - [ ] Retry count increments
  - [ ] Failure emails sent
  - [ ] Max retries respected (3 attempts)

### Manual Testing Endpoints
- [ ] **POST** `/api/admin/payment-plans/process-manual`
  - [ ] Processes all due payments
  - [ ] Works with `override_date` parameter
  - [ ] Works with specific `transaction_id`
  - [ ] Returns detailed results
  - [ ] Requires `ADMIN_SECRET`
- [ ] **POST** `/api/admin/payment-plans/update-schedule`
  - [ ] Updates single transaction date
  - [ ] Updates all transactions for plan
  - [ ] Schedules with `days_from_now` parameter
  - [ ] Works with specific date
  - [ ] Requires `ADMIN_SECRET`

---

## Phase 6: Payment Processing Scenarios

### Successful Payment Flow
1. [ ] First payment succeeds immediately
2. [ ] Payment plan created successfully
3. [ ] 30 days later, second payment processes
4. [ ] Email sent for payment processed
5. [ ] 30 days later, third payment processes
6. [ ] 30 days later, fourth payment processes
7. [ ] Plan marked as completed
8. [ ] Completion email sent

### Payment Failure & Retry
1. [ ] Payment fails (use declining test card)
2. [ ] Transaction status set to 'failed'
3. [ ] Failure reason recorded
4. [ ] Attempt count incremented
5. [ ] Failure email sent to user
6. [ ] User updates payment method
7. [ ] 24 hours later, retry attempted
8. [ ] Retry succeeds
9. [ ] Success email sent
10. [ ] Plan continues normally

### Max Retries Exceeded
1. [ ] Payment fails
2. [ ] Retry 1 fails (24hrs later)
3. [ ] Retry 2 fails (24hrs later)
4. [ ] Retry 3 fails (24hrs later)
5. [ ] Transaction remains 'failed'
6. [ ] No more retry attempts
7. [ ] Admin can see failed status
8. [ ] User notified of all failures

### Early Payoff
1. [ ] User has active payment plan
2. [ ] **POST** `/api/payment-plans/[id]/payoff`
3. [ ] Remaining balance calculated
4. [ ] Payment processed via Stripe
5. [ ] All pending transactions marked 'completed'
6. [ ] Payment plan status set to 'completed'
7. [ ] Completion email sent
8. [ ] Xero payment recorded

---

## Phase 7: Payment Method Management

### Payment Method Removal with Outstanding Balance
- [ ] User has active payment plan
- [ ] User attempts to remove payment method
- [ ] **DELETE** `/api/remove-payment-method`
- [ ] Request blocked
- [ ] Error message shows outstanding amount
- [ ] Response includes `requiresPayoff: true`
- [ ] User cannot remove payment method

### Payment Method Removal without Balance
- [ ] User has completed payment plans
- [ ] User attempts to remove payment method
- [ ] Request succeeds
- [ ] Payment method removed from profile
- [ ] Webhook processes detachment

---

## Phase 8: Email Notifications

### Pre-Notification Email (3 days before)
- [ ] Email received 3 days before charge
- [ ] Subject line correct
- [ ] User name displays
- [ ] Registration name displays
- [ ] Installment number correct (e.g., "2 of 4")
- [ ] Installment amount formatted
- [ ] Next payment date formatted
- [ ] Amount paid displays
- [ ] Remaining balance displays
- [ ] Account settings URL included

### Payment Processed Email
- [ ] Email received after successful payment
- [ ] Subject line correct
- [ ] Payment details correct
- [ ] Progress shows (e.g., "2 of 4")
- [ ] Next payment date shows OR "No more payments due"
- [ ] Amounts formatted correctly
- [ ] Dashboard URL included
- [ ] Final payment shows congratulations message

### Payment Failed Email
- [ ] Email received after payment failure
- [ ] Subject includes "Action Required"
- [ ] Failure reason displayed
- [ ] Scheduled date shown
- [ ] Remaining retries count correct
- [ ] Retry timeline explained (24 hours)
- [ ] Account settings URL included
- [ ] Instructions for updating payment method

### Plan Completed Email
- [ ] Email received when plan completed
- [ ] Subject includes "Complete! 🎉"
- [ ] Congratulations message
- [ ] Total amount shown
- [ ] Number of installments shown
- [ ] Start and completion dates shown
- [ ] Dashboard URL included

---

## Phase 9: Xero Integration

### Invoice Creation
- [ ] Single Xero invoice created for full amount
- [ ] Invoice marked with payment plan indicator
- [ ] Invoice shows in user's payment history
- [ ] Invoice status starts as "Authorised" or "Awaiting Payment"

### Payment Recording
- [ ] First installment recorded against invoice
- [ ] Invoice status updates to "Partially Paid"
- [ ] Each subsequent payment recorded
- [ ] Invoice amount reduces with each payment
- [ ] Final payment marks invoice as "Paid"

### Xero Sync
- [ ] Staging records created
- [ ] Batch sync processes correctly
- [ ] Invoice appears in Xero dashboard
- [ ] Payments appear in Xero
- [ ] Amounts match exactly

---

## Phase 10: Edge Cases & Error Handling

### Edge Cases
- [ ] User with $0 registration (free) - no payment plan
- [ ] User tries payment plan without saved payment method
- [ ] User disables payment plan mid-cycle (what happens?)
- [ ] Multiple registrations with payment plans
- [ ] Payment plan with discount codes applied
- [ ] Payment plan with promo codes applied
- [ ] Timezone handling for scheduled dates
- [ ] Payment scheduled on non-existent date (e.g., Feb 31)

### Error Scenarios
- [ ] Stripe API down during payment processing
- [ ] Database connection lost during transaction
- [ ] Xero API unavailable
- [ ] Loops email API error
- [ ] User account deleted with active plan
- [ ] Payment method expired mid-plan
- [ ] Duplicate payment processing prevented
- [ ] Race conditions handled

### Security
- [ ] Only admin can toggle eligibility
- [ ] Users can only see their own plans
- [ ] Admin endpoints require authentication
- [ ] ADMIN_SECRET validated
- [ ] SQL injection prevented
- [ ] XSS prevented in UI

---

## Phase 11: Reporting & Monitoring

### Admin Visibility
- [ ] Can see all users with payment plans
- [ ] Can filter by eligibility
- [ ] Can filter by active balances
- [ ] Can view individual plan details
- [ ] Can see payment history
- [ ] Can see failed payments
- [ ] Can see retry attempts

### Logs & Debugging
- [ ] Payment processing logged
- [ ] Failures logged with details
- [ ] Retry attempts logged
- [ ] Admin actions logged
- [ ] Webhook events logged
- [ ] Cron job results logged

---

## Still To Implement (Not Yet Complete)

### Registration Checkout UI
**Status**: Backend ready, UI needs implementation

**What's needed**:
- [ ] Add payment plan option to registration checkout page
- [ ] Radio button: "Pay in Full" vs "Payment Plan"
- [ ] Show 4-payment breakdown when payment plan selected
- [ ] Display: "First payment: Today - $X" and "3 monthly payments of $X"
- [ ] Validate saved payment method exists before showing option
- [ ] Pass `usePaymentPlan: true` to payment intent API
- [ ] Update checkout flow to handle response
- [ ] Show appropriate messaging during checkout

**Test When Implemented**:
- [ ] Option appears for eligible users
- [ ] Option hidden for non-eligible users
- [ ] Breakdown calculates correctly
- [ ] First payment amount matches API
- [ ] Can successfully complete checkout with payment plan
- [ ] Cannot select if no saved payment method

---

### User Account Page
**Status**: Backend ready, UI needs implementation

**What's needed**:
- [ ] Find or create user account/dashboard page
- [ ] Add "Payment Plans" section
- [ ] List all active payment plans
- [ ] Show for each plan:
  - Registration name
  - Total amount and remaining balance
  - Progress (X/4 installments)
  - Next payment date
  - "Pay Remaining Balance" button
- [ ] Implement early payoff flow:
  - Click "Pay Remaining Balance"
  - Show confirmation modal with amount
  - Process payment via `/api/payment-plans/[id]/payoff`
  - Show success/error message
  - Update UI

**Test When Implemented**:
- [ ] User can view their active plans
- [ ] Information displays correctly
- [ ] Pay remaining balance button works
- [ ] Confirmation modal shows correct amount
- [ ] Payment processes successfully
- [ ] Plan marked as completed
- [ ] Completion email sent
- [ ] UI updates to show completed status

---

### Account Deletion Protection
**Status**: Backend ready, integration needed

**What's needed**:
- [ ] Find account deletion endpoint/flow
- [ ] Add check for active payment plans:
  ```typescript
  const hasBalance = await PaymentPlanService.hasOutstandingBalance(userId)
  if (hasBalance) {
    return error("Cannot delete account with outstanding payment plan balance")
  }
  ```
- [ ] Update UI to show error message
- [ ] Optionally: offer to pay off balance first
- [ ] Ensure payment method detached on deletion

**Test When Implemented**:
- [ ] User with active plan cannot delete account
- [ ] Clear error message displayed
- [ ] User with completed plans can delete account
- [ ] User without plans can delete account normally
- [ ] Payment method properly cleaned up

---

## Performance Testing

- [ ] Test with 100+ users with payment plans
- [ ] Test cron job processing 50+ due payments
- [ ] Test admin report page with large dataset
- [ ] Verify query performance with indexes
- [ ] Check database connection pooling

---

## Documentation

- [ ] README updated with payment plans feature
- [ ] API documentation complete
- [ ] Email template setup instructions clear
- [ ] Environment variables documented
- [ ] Testing guide accessible
- [ ] Admin user guide created
- [ ] User-facing help documentation

---

## Production Readiness

- [ ] All tests passing
- [ ] Error logging configured
- [ ] Monitoring set up
- [ ] Alerts configured for payment failures
- [ ] Backup strategy for payment data
- [ ] Rollback plan documented
- [ ] Feature flag for gradual rollout (optional)
- [ ] Admin training completed
- [ ] User communication plan ready

---

## Notes

- Use testing guide at `/docs/testing/payment-plans-testing-guide.md` for detailed testing procedures
- Manual testing endpoints available for fast iteration
- Test cards available in testing guide
- All backend APIs are fully functional and ready to use
- Admin UI is complete and functional
- User-facing UI requires 3 more components (listed above)

---

## Sign-Off

- [ ] Backend implementation verified
- [ ] Admin UI verified
- [ ] Email notifications verified
- [ ] Xero integration verified
- [ ] User-facing UI completed and verified
- [ ] Production deployment approved
- [ ] Feature ready for launch
