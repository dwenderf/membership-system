# Waitlist Management System

**Status**: ✅ Completed | **PR**: #5 | **Date**: October 15, 2025

## Summary
Implements a complete waitlist management system for registrations, allowing users to join waitlists when registrations are
full, and enabling admins to select and charge waitlisted users when spots become available. Includes payment processing, email
notifications, Xero integration, discount code support, and price override capabilities.

  ## Features

  ### 1. User-Facing Waitlist Features

  **Joining Waitlist**
  - Users can join waitlist when registration categories are at capacity
  - Discount codes can be applied when joining waitlist (saved for later use)
  - Payment method setup required before joining (via Stripe Setup Intent)
  - Clean UI with "Waitlist" badge next to category name
  - Position numbers hidden from users to avoid anxiety
  - Simple messaging: "We'll notify you if a spot becomes available"

  **Waitlist Status Display**
  - "On Waitlist" button shown instead of registration button
  - Badge format matches "Registered" badge pattern for consistency
  - Status visible in browse registrations and user dashboard
  - Differentiated from registered categories with distinct styling

  **Payment Method Setup**
  - Setup Intent modal appears if payment method not configured
  - Saves payment method for future automatic charges
  - Validates payment method before allowing waitlist join
  - Clear messaging about future charges when selected

  ### 2. Admin Waitlist Management

  **Registration Reports Page Reorganization**
  - `/admin/reports/registrations` - Grid of clickable registration tiles
  - `/admin/reports/registrations/[id]` - Detailed registration page with:
    - Registration name + season as page title
    - Back navigation link
    - Searchable participant list organized by category
    - Collapsible waitlist section organized by category
    - Real-time data on payment method status

  **Waitlist Table Features**
  - Shows position, user info, LGBTQ+ status, goalie status
  - Payment method status column ("Ready" or "Setup Required")
  - Discount code column showing applied codes
  - "Select" button to choose user from waitlist (disabled if no payment method)
  - Sortable columns for easy management

  **Waitlist Selection & Payment Processing**
  - Modal confirmation before selecting user
  - Shows user details, registration info, and pricing breakdown
  - Automatic payment processing using saved payment method
  - Real-time price override capability for mid-season joins
  - Discount codes apply to adjusted base price
  - Success/failure feedback with detailed error messages

  **Price Override for Mid-Season Joins**
  - Checkbox to enable price override
  - Number input with live validation (min: $0, max: original price)
  - Real-time pricing breakdown recalculation
  - Discount percentages apply to new base price
  - Preserves separate accounting codes for Xero

  **Audit Trail**
  - Tracks which admin selected each user from waitlist
  - `selected_by_admin_id` field records admin action
  - Timestamp of selection (`removed_at` field)

  ### 3. Payment & Financial Processing

  **Waitlist Payment Service**
  - Dedicated service for charging waitlisted users
  - Uses saved Stripe payment method for automatic charging
  - Applies discount codes to final amount
  - Creates payment and registration records atomically
  - Handles free registrations (100% discount)
  - Xero staging integration for accounting

  **Stripe Webhook Integration**
  - Dedicated handler for `purpose: 'waitlist_selection'` payments
  - Mirrors alternate selection pattern for consistency
  - Updates payment status to 'completed'
  - Verifies registration record creation
  - Triggers post-processing (Xero sync, emails)
  - No race conditions - follows alternates pattern

  **Xero Integration**
  - Separate line items for base price and discount
  - Correct accounting codes preserved for each
  - Batch sync support with proper error handling
  - Staging records created immediately
  - Invoice and payment records linked properly

  ### 4. Email Notifications

  **Waitlist Joined Email**
  - Sent when user joins waitlist
  - Includes registration name and season information
  - Category details and position (internal tracking only)
  - Instructions for next steps
  - Clear messaging about payment method requirement

  **Waitlist Selected Email**
  - Sent when admin selects user from waitlist
  - Registration confirmation details
  - Amount charged breakdown (base price, discount, total)
  - Payment intent ID for reference
  - Welcome message and event details

  ### 5. Data Model Changes

  **New Tables/Fields**
  ```sql
  -- Waitlists table
  CREATE TABLE waitlists (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users(id),
    registration_id uuid REFERENCES registrations(id),
    registration_category_id uuid REFERENCES registration_categories(id),
    discount_code_id uuid REFERENCES discount_codes(id),
    position integer,
    joined_at timestamp,
    removed_at timestamp,
    selected_by_admin_id uuid REFERENCES users(id)
  );

  -- User registrations enhanced
  ALTER TABLE user_registrations
  ADD COLUMN registration_fee integer; -- Supports price override

  Technical Implementation

  Key Files Created/Modified

  Frontend Components
  - WaitlistSelectionModal.tsx - Admin selection confirmation with price override
  - RegistrationPurchase.tsx - Waitlist join flow with discount codes
  - admin/reports/registrations/page.tsx - Simplified tile grid
  - admin/reports/registrations/[id]/page.tsx - New detail page

  Backend Services
  - waitlist-payment-service.ts - Payment processing for selections
  - alternate-payment-service.ts - Reference pattern for consistency
  - email/service.ts - Email notification templates

  API Endpoints
  - POST /api/waitlists/[waitlistId]/select - Select user from waitlist
  - GET /api/admin/reports/registrations - List registrations
  - GET /api/admin/reports/registrations?registrationId=[id] - Get details

  Database
  - 2025-10-14-add-selected-by-admin-to-waitlists.sql - Audit trail migration

  Architecture Decisions

  1. Payment Method Requirement: Users must have payment method before joining to enable automatic charging
  2. Position Hiding: Don't show position to users to reduce anxiety
  3. Atomic Operations: Payment and registration creation happen together
  4. Webhook Pattern: Follows alternate selection pattern for consistency
  5. Price Override: Stored in registration_fee field, not amount_paid
  6. Accounting Integrity: Discount codes maintain separate accounting codes even with override

  User Flow

  User Joins Waitlist

  1. Browse to full registration category
  2. See "Join Waitlist" option instead of "Register"
  3. If no payment method: Setup Intent modal appears
  4. Save payment method for future charges
  5. Optionally enter discount code
  6. Click "Join Waitlist"
  7. Receive confirmation email
  8. See "On Waitlist" badge in dashboard

  Admin Selects from Waitlist

  1. Navigate to registration reports
  2. Click on registration tile
  3. View waitlist section organized by category
  4. See payment method status for each user
  5. Click "Select" button for user with valid payment method
  6. Review pricing breakdown in modal
  7. Optionally override base price (e.g., mid-season join)
  8. Confirm selection
  9. Payment processed automatically
  10. Registration record created
  11. User receives confirmation email
  12. Waitlist entry marked as removed with admin ID

  Testing Checklist

  - ✅ User can join waitlist with discount code
  - ✅ Payment method setup flow works correctly
  - ✅ Admin can view waitlist organized by category
  - ✅ Admin can select user and process payment
  - ✅ Price override validates correctly (0 to max)
  - ✅ Discount codes apply to override price
  - ✅ Emails sent for join and selection
  - ✅ Xero invoices sync with correct accounting codes
  - ✅ Webhook processes waitlist payments correctly
  - ✅ Audit trail records admin selections
  - ✅ Page stays on detail view after selection
  - ✅ Free registrations (100% discount) handled
  - ✅ Payment failures show proper error messages

  Example Scenarios

  Standard Waitlist Selection
  - User on waitlist with 10% discount code
  - Base price: $100, Discount: -$10, Total: $90
  - Admin selects, charge processes automatically

  Mid-Season Join with Override
  - User joins mid-season (only 6 weeks remaining of 12)
  - Base price: $100, Override: $50
  - With 10% discount: $50 - $5 = $45 charged
  - Xero invoice: Two line items with correct accounting codes

  Free Registration
  - User has 100% discount code
  - No Stripe charge created
  - Registration marked as 'paid' immediately
  - Xero invoice created showing discount

  Database Migrations

  Run migrations in order:
  supabase db push

  Configuration Required

  None - uses existing Stripe and Xero configuration

  Breaking Changes

  None - all changes are additive and backward compatible

  Future Enhancements

  - Automated waitlist promotion when spots open
  - Waitlist notification preferences
  - Bulk waitlist selection
  - Waitlist analytics and reporting
  - Custom email templates per registration

  ---
  🤖 Generated with https://claude.com/claude-code

  Co-Authored-By: Claude noreply@anthropic.com