# Implementation Plan

## Phase 1: Core Alternate Registration System (Admin-Only)

- [x] 1. Set up database schema for alternate registration system
  - Create database migration for new tables and schema modifications
  - Add Setup Intent fields to users table (stripe_setup_intent_id, stripe_payment_method_id, setup_intent_status, payment_method_updated_at)
  - Add alternate configuration fields to registrations table (allow_alternates, alternate_price, alternate_accounting_code)
  - Create user_alternate_registrations table for tracking which users want to be alternates for registrations
  - Create alternate_registrations table for tracking games/events that need alternates (with game_description, game_date, created_by)
  - Create alternate_selections table for tracking which users are selected for specific games (with unique constraint)
  - Create registration_captains table for captain assignment management
  - Add appropriate indexes and RLS policies for security
  - Add unique constraints to prevent duplicate registrations and selections
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 9.1, 9.2_

- [x] 2. Implement Stripe Setup Intent integration
  - Create Setup Intent service for payment method management
  - Implement createSetupIntent function to save payment methods without charging
  - Implement confirmSetupIntent function to handle successful payment method setup
  - Implement detachPaymentMethod function for payment method removal
  - Add webhook handlers for setup_intent.succeeded and payment_method.detached events
  - Update existing webhook processing to handle alternate payment events
  - _Requirements: 1.4, 8.1, 8.2, 11.1, 11.3_

- [ ] 3. Create user alternate registration API endpoints
  - Implement POST /api/user-alternate-registrations endpoint for users to register as alternates for registrations
  - Add validation to prevent regular participants from registering as alternates
  - Add logic to check for existing Setup Intent before creating new one
  - Implement discount code validation and storage for future use
  - Add proper error handling for Setup Intent creation failures
  - Implement GET /api/user/alternate-registrations endpoint to show user's alternate registrations
  - Create unit tests for user alternate registration logic
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

- [ ] 4. Implement registration configuration for alternates
  - Add alternate configuration fields to registration creation/edit forms
  - Implement validation requiring price and accounting code when alternates are enabled
  - Update registration display logic to show alternate options when enabled
  - Add admin interface for configuring alternate settings per registration
  - Create tests for registration alternate configuration
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 5. Develop game creation and alternate selection system (Admin-Only)
  - Create game creation interface for admins to create games that need alternates (POST /api/alternate-registrations)
  - Implement game management interface showing all games for a registration
  - Create available alternates list view showing users who registered as alternates for the registration
  - Implement alternate selection interface allowing multiple selections per game
  - Add discount usage status display with warning indicators for over-limit discounts
  - Implement payment processing using saved payment methods with registration-level pricing
  - Create invoice generation using registration.alternate_price and registration.alternate_accounting_code
  - Add discount line items when applicable using discount_codes table
  - Add confirmation dialog for alternates with over-limit discounts
  - Add validation to prevent duplicate selections for same game
  - Integrate with existing payment staging flow (xero_invoices, xero_payments, xero_invoice_line_items)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [ ] 6. Implement payment method management for users
  - Create user dashboard for viewing saved payment methods
  - Add payment method display showing last 4 digits, card type, and expiration
  - Implement payment authorization removal with warning about alternate list removal
  - Add confirmation flow for payment method removal
  - Create payment method update functionality using new Setup Intents
  - Add proper cleanup when payment methods are removed
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 7. Set up email notification system
  - Create LOOPS email template for alternate selection notifications
  - Create LOOPS email template for payment authorization removal
  - Add environment variables for LOOPS template IDs
  - Implement email sending for alternate selection with game description and charge amount
  - Implement email sending for payment authorization removal confirmation
  - Create tests for email notification functionality
  - _Requirements: 4.1, 4.2, 4.6, 5.5, 5.6_

- [ ] 8. Implement webhook processing and error handling
  - Add Stripe webhook handlers for payment_intent.succeeded events from alternate charges
  - Add Stripe webhook handlers for payment_intent.payment_failed events
  - Implement webhook signature verification for security
  - Add idempotent webhook processing to handle duplicate events
  - Implement error handling and retry logic with exponential backoff
  - Add comprehensive logging for all alternate payment events
  - Create tests for webhook processing functionality
  - _Requirements: 8.5, 8.6, 11.2, 11.4, 11.5, 11.6, 11.7_

- [ ] 9. Add Phase 1 testing and deployment
  - Create integration tests for complete alternate registration flow
  - Add tests for payment method setup and charging workflow
  - Create tests for discount limit validation and application
  - Add tests for email notification delivery
  - Add security tests for access control and data protection
  - Add required environment variables for LOOPS templates
  - Update production database with new schema migrations
  - Configure Stripe webhook endpoints for new events
  - Perform production testing with real payment methods
  - _Requirements: Phase 1 validation and deployment_

## Phase 2: Analytics and Reporting

- [ ] 10. Build analytics and reporting system
  - Create alternate registration analytics dashboard for admins
  - Implement alternate usage tracking and reporting
  - Add financial reporting for alternate payments with game descriptions
  - Create user activity tracking for alternate registrations and selections
  - Implement games played tracking per alternate
  - Add alternate history display with game descriptions and dates
  - Create tests for analytics functionality
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

## Phase 3: Captain Management System

- [ ] 11. Update game creation and selection for captain access
  - Update game creation interface to allow captains (not just admins) to create games
  - Update alternate selection interface to allow captains to select alternates for their games
  - Add captain permission validation for game creation and alternate selection
  - Update API endpoints to support captain access based on registration_captains table
  - _Requirements: 9.3, 9.4_

- [ ] 12. Build captain management system
  - Create registration captain assignment interface for admins (POST /api/admin/registrations/{id}/captains)
  - Implement captain selection from existing members
  - Add captain dashboard showing only assigned registrations (GET /api/captain/registrations)
  - Implement captain removal functionality with access revocation (DELETE /api/admin/registrations/{id}/captains/{userId})
  - Add notification system for captain assignment/removal
  - Create tests for captain management functionality
  - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7_

- [ ] 13. Final testing and deployment
  - Add tests for captain management and permissions
  - Implement performance tests for concurrent alternate selections
  - Create end-to-end tests covering the full captain workflow
  - Set up monitoring and alerting for captain activities
  - Create admin documentation for managing captains
  - Deploy captain functionality to production
  - _Requirements: All requirements validation_
