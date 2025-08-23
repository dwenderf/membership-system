# Requirements Document

## Introduction

The alternate registration system allows members to register as alternates for hockey events and other registrations that support alternates. This system enables captains to select alternates when regular registrations are insufficient, with pre-authorized payments to streamline the selection process. The feature ensures fair access to events while maintaining payment security through Stripe pre-authorization.

## Requirements

### Requirement 1

**User Story:** As a member, I want to register as an alternate for hockey events, so that I can participate when regular spots become available.

#### Acceptance Criteria

1. WHEN a member views a registration that allows alternates THEN the system SHALL display a "Register as Alternate" option
2. WHEN a member clicks "Register as Alternate" THEN the system SHALL check if they have an active Setup Intent
3. IF a member has an active Setup Intent THEN the system SHALL display a message that they will be automatically charged if selected
4. IF a member does not have an active Setup Intent THEN the system SHALL create a Stripe Setup Intent to save their payment method
5. WHEN a member clicks "Register as Alternate" THEN the system SHALL provide an optional discount code field
6. WHEN a member enters a discount code THEN the system SHALL validate the code for future use
7. WHEN an alternate registration is successful THEN the system SHALL add the member to the alternates list for that registration
8. WHEN an alternate registration includes a discount code THEN the system SHALL store the discount code for future charges
9. IF a member is already registered as a regular participant THEN the system SHALL NOT allow them to register as an alternate
10. IF a member is already registered as an alternate THEN the system SHALL display their current alternate status

### Requirement 2

**User Story:** As an administrator, I want to configure which registrations allow alternates, so that I can control which events support the alternate system.

#### Acceptance Criteria

1. WHEN creating or editing a registration THEN the system SHALL provide an "Allow Alternates" checkbox option
2. WHEN "Allow Alternates" is enabled THEN the system SHALL require a price for alternate spots
3. WHEN "Allow Alternates" is enabled THEN the system SHALL require an accounting code for alternate revenue
4. WHEN "Allow Alternates" is enabled THEN the system SHALL display alternate registration options to members
5. WHEN "Allow Alternates" is disabled THEN the system SHALL hide alternate registration functionality for that registration
6. WHEN viewing registration details THEN the system SHALL clearly indicate whether alternates are allowed and show the alternate price

### Requirement 3

**User Story:** As a captain of a registration or as an admin, I want to view and select alternates from the registered alternates list, so that I can fill spots when regular players are unavailable.

#### Acceptance Criteria

1. WHEN a captain or admin views a registration with alternates THEN the system SHALL display a list of registered alternates
2. WHEN a captain or admin selects an alternate THEN the system SHALL require a game description (required field)
3. WHEN an alternate is selected THEN the system SHALL create an invoice with the registration's alternate accounting code as the primary line item
4. WHEN an alternate is selected AND they have a discount code THEN the system SHALL add a second line item using the discount code's accounting code (negative amount)
5. WHEN an alternate is selected AND they have a financial aid discount THEN the system SHALL verify the discount usage cap before applying
6. WHEN an alternate is selected THEN the system SHALL charge their saved payment method for the calculated amount
7. WHEN an alternate is selected THEN the system SHALL include the provided description in the invoice line item
8. WHEN an alternate is selected THEN the system SHALL send confirmation notifications to the selected alternate
9. WHEN an alternate is selected THEN the system SHALL keep them on the alternates list for future selections
10. WHEN an alternate is selected THEN the system SHALL track the game participation for reporting purposes

### Requirement 4

**User Story:** As a member registered as an alternate, I want to receive notifications when I'm selected, so that I know I'm participating in a specific game.

#### Acceptance Criteria

1. WHEN an alternate is selected by a captain or admin THEN the system SHALL send an email notification to the alternate using a LOOPS email template
2. WHEN sending the notification THEN the system SHALL include the game description, charge amount, and registration details
3. WHEN an alternate is selected THEN the system SHALL process their saved payment method for that game
4. WHEN an alternate is selected THEN the system SHALL maintain their alternate status for future games
5. IF payment processing fails THEN the system SHALL notify both the captain/admin and the alternate of the failure
6. WHEN implementing email notifications THEN the system SHALL use a LOOPS template ID stored in environment variables for alternate selection notifications

### Requirement 5

**User Story:** As a member, I want to cancel my payment authorization for alternate registrations, so that I can withdraw if my availability changes.

#### Acceptance Criteria

1. WHEN a member views their payment methods dashboard THEN the system SHALL provide a "Remove Payment Authorization" option
2. WHEN a member clicks to remove authorization THEN the system SHALL warn them that this will remove them from ALL alternate lists
3. WHEN a member confirms removal THEN the system SHALL detach their saved payment method from Stripe
4. WHEN a member confirms removal THEN the system SHALL remove them from all alternate lists where this payment method was used
5. WHEN payment authorization is removed THEN the system SHALL send a confirmation email using a LOOPS template
6. WHEN implementing removal notifications THEN the system SHALL use a LOOPS template ID stored in environment variables for payment authorization removal
7. WHEN a member wants to become an alternate again THEN the system SHALL require them to set up payment authorization again

### Requirement 6

**User Story:** As an administrator, I want to view alternate registration analytics, so that I can understand usage patterns and optimize the system.

#### Acceptance Criteria

1. WHEN viewing registration reports THEN the system SHALL display alternate registration counts
2. WHEN viewing registration details THEN the system SHALL show the number of registered alternates
3. WHEN viewing financial reports THEN the system SHALL include alternate payment data with game descriptions
4. WHEN viewing user activity THEN the system SHALL track alternate registration and selection events
5. WHEN viewing alternate analytics THEN the system SHALL show games played per alternate
6. WHEN viewing alternate history THEN the system SHALL display game descriptions and dates for each selection

### Requirement 7

**User Story:** As a member, I want to manage my saved payment method for alternate registrations, so that I have control over my payment information.

#### Acceptance Criteria

1. WHEN a member views their account dashboard THEN the system SHALL display their saved payment method if one exists
2. WHEN a member views their saved payment method THEN the system SHALL show the last 4 digits, card type, and expiration date
3. WHEN a member wants to revoke their payment method THEN the system SHALL provide a "Remove Payment Authorization" option
4. WHEN a member removes their payment method THEN the system SHALL detach it from Stripe and remove them from all alternate lists
5. WHEN a member removes their payment method THEN the system SHALL send a confirmation notification
6. WHEN a member wants to update their payment method THEN the system SHALL allow them to set up a new Setup Intent

### Requirement 8

**User Story:** As a system, I want to handle payment method storage securely, so that alternates can be charged seamlessly when selected throughout the season.

#### Acceptance Criteria

1. WHEN an alternate registers THEN the system SHALL create a Stripe Setup Intent to securely save their payment method (if they don't already have one)
2. WHEN an alternate completes payment method setup THEN the system SHALL store only the payment method ID for future charges
3. WHEN an alternate is selected THEN the system SHALL create a new Payment Intent using their saved payment method
4. WHEN an alternate is selected THEN the system SHALL charge the calculated amount (base price minus any applicable discounts)
5. WHEN payment charging fails THEN the system SHALL handle the error gracefully and notify relevant parties
6. WHEN a saved payment method expires or becomes invalid THEN the system SHALL notify the alternate to update their payment method
7. WHEN the system stores payment methods THEN it SHALL associate them with the user account for use across all registrations

### Requirement 9

**User Story:** As an administrator, I want to assign and remove captains from registrations, so that they can manage alternates for their teams.

#### Acceptance Criteria

1. WHEN creating or editing a registration THEN the system SHALL provide an option to assign one or more captains
2. WHEN assigning captains THEN the system SHALL allow selection from existing members
3. WHEN a captain is assigned THEN the system SHALL grant them access to manage alternates for that registration
4. WHEN a captain views their dashboard THEN the system SHALL display only registrations where they are assigned as captain
5. WHEN an administrator views registrations THEN the system SHALL display captain management options for all registrations
6. WHEN an administrator removes a captain THEN the system SHALL revoke their access to manage alternates for that registration
7. WHEN an administrator removes a captain THEN the system SHALL send a notification to the removed captain

### Requirement 10

**User Story:** As a captain or admin, I want to see discount usage status for alternates, so that I can inform them about potential charges.

#### Acceptance Criteria

1. WHEN viewing the alternates list THEN the system SHALL display each alternate's discount code status
2. WHEN an alternate has a discount code that is over the usage limit THEN the system SHALL display a warning indicator
3. WHEN an alternate with an over-limit discount is selected THEN the system SHALL show a confirmation dialog warning about the charge
4. WHEN an alternate has a discount within limits THEN the system SHALL apply the full discount amount
5. WHEN an alternate has a discount over limits THEN the system SHALL apply the remaining discount amount (if any) before creating the invoice
6. WHEN processing alternates with discounts THEN the system SHALL still require a saved payment method for potential charges

### Requirement 11

**User Story:** As a system, I want to handle Stripe webhook events for alternate payments, so that payment status changes are properly synchronized.

#### Acceptance Criteria

1. WHEN Stripe sends a `setup_intent.succeeded` webhook THEN the system SHALL confirm the payment method is saved for the alternate registration
2. WHEN Stripe sends a `payment_intent.succeeded` webhook for an alternate charge THEN the system SHALL update the payment status and send confirmation notifications
3. WHEN Stripe sends a `payment_method.detached` webhook THEN the system SHALL remove the alternate from the registration list
4. WHEN Stripe sends a `payment_intent.payment_failed` webhook THEN the system SHALL notify the captain and alternate of the failed charge
5. WHEN processing webhook events THEN the system SHALL verify the webhook signature for security
6. WHEN processing webhook events THEN the system SHALL handle duplicate events gracefully using idempotency
7. WHEN a webhook event cannot be processed THEN the system SHALL log the error and retry with exponential backoff