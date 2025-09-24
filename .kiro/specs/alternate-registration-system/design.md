# Design Document

## Overview

The alternate registration system extends the existing hockey membership and registration platform to support alternate players who can be selected by captains for specific games throughout a season. The system uses Stripe Setup Intents to securely store payment methods without pre-authorization, allowing on-demand charging when alternates are selected. The design integrates seamlessly with the existing payment flow, Xero synchronization, and email notification systems.

## Architecture

### High-Level Flow

1. **Registration Phase**: Members register as alternates for registrations with optional discount codes and Setup Intent creation
2. **Game Creation**: Captains create specific games/events within registrations that need alternates
3. **Alternate Selection**: Captains select alternates for specific games from the pool of registered alternates
4. **Payment Processing**: System charges saved payment methods using registration-level pricing and creates invoices through existing staging flow
5. **Notification**: Email notifications sent via LOOPS templates
6. **Xero Sync**: Invoice and payment data synchronized to Xero accounting system

### Integration Points

- **Existing Payment Flow**: Leverages current `payments`, `xero_invoices`, `xero_invoice_line_items`, and `xero_payments` tables
- **Stripe Integration**: Uses Setup Intents instead of Payment Intents for long-term payment method storage
- **Email System**: Integrates with existing LOOPS email service and templates
- **Discount System**: Reuses existing discount codes and usage tracking
- **Admin System**: Extends current admin interface for captain management

## Components and Interfaces

### Database Schema Extensions

#### New Tables

**alternate_registrations**

```sql
CREATE TABLE alternate_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    game_description TEXT NOT NULL, -- "Game vs Team A on Jan 15"
    game_date TIMESTAMP WITH TIME ZONE, -- When the game happens
    created_by UUID NOT NULL REFERENCES users(id), -- Captain or admin who created this game
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**registration_captains**

```sql
CREATE TABLE registration_captains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by UUID NOT NULL REFERENCES users(id),
    
    UNIQUE(registration_id, user_id)
);
```

**alternate_selections**

```sql
CREATE TABLE alternate_selections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alternate_registration_id UUID NOT NULL REFERENCES alternate_registrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Which user is selected
    discount_code_id UUID REFERENCES discount_codes(id), -- Their discount (if any)
    payment_id UUID REFERENCES payments(id), -- Links to payment record
    amount_charged INTEGER NOT NULL, -- Final amount after discounts (in cents)
    selected_by UUID NOT NULL REFERENCES users(id), -- Captain or admin who selected
    selected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(alternate_registration_id, user_id) -- Prevents duplicate selections for same game
);
```

**user_alternate_registrations**

```sql
CREATE TABLE user_alternate_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    discount_code_id UUID REFERENCES discount_codes(id), -- User's discount for this registration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, registration_id) -- User can only register as alternate once per registration
);
```

#### Schema Modifications

**users table additions**

```sql
ALTER TABLE users ADD COLUMN stripe_setup_intent_id TEXT; -- Stripe Setup Intent ID
ALTER TABLE users ADD COLUMN stripe_payment_method_id TEXT; -- Saved payment method from Setup Intent
ALTER TABLE users ADD COLUMN setup_intent_status TEXT CHECK (setup_intent_status IN ('pending', 'succeeded', 'failed'));
ALTER TABLE users ADD COLUMN payment_method_updated_at TIMESTAMP WITH TIME ZONE; -- When payment method was last updated
```

**registrations table additions**

```sql
ALTER TABLE registrations ADD COLUMN allow_alternates BOOLEAN DEFAULT FALSE;
ALTER TABLE registrations ADD COLUMN alternate_price INTEGER; -- Price in cents for alternate spots
ALTER TABLE registrations ADD COLUMN alternate_accounting_code TEXT; -- Accounting code for alternate revenue
```

### API Endpoints

#### User Alternate Registration Management

- `POST /api/user-alternate-registrations` - Register as alternate for a registration
- `DELETE /api/user-alternate-registrations/{id}` - Cancel alternate registration
- `GET /api/user/alternate-registrations` - Get user's alternate registrations
- `POST /api/user/setup-intent` - Create/update Setup Intent for payment method

#### Game/Event Management

- `POST /api/alternate-registrations` - Create game/event that needs alternates
- `GET /api/registrations/{id}/games` - Get games for a registration
- `PUT /api/alternate-registrations/{id}` - Update game details
- `DELETE /api/alternate-registrations/{id}` - Cancel game

#### Captain Management

- `GET /api/alternate-registrations/{id}/available-alternates` - Get available alternates for a game
- `POST /api/alternate-registrations/{id}/select-alternates` - Select multiple alternates for game
- `GET /api/captain/registrations` - Get registrations where user is captain
- `GET /api/captain/games` - Get games created by captain

#### Admin Management

- `POST /api/admin/registrations/{id}/captains` - Assign captains
- `DELETE /api/admin/registrations/{id}/captains/{userId}` - Remove captain
- `GET /api/admin/alternate-analytics` - Get alternate usage analytics

#### Payment Method Management

- `GET /api/user/payment-methods` - Get user's saved payment methods
- `DELETE /api/user/payment-methods/{id}` - Remove payment authorization

### Stripe Integration Components

#### Setup Intent Service

```typescript
interface SetupIntentService {
  createSetupIntent(userId: string): Promise<SetupIntent>
  confirmSetupIntent(setupIntentId: string): Promise<PaymentMethod>
  detachPaymentMethod(paymentMethodId: string): Promise<void>
}
```

#### Payment Processing Service

```typescript
interface AlternatePaymentService {
  chargeAlternate(
    userId: string,
    registrationId: string,
    gameDescription: string,
    discountCodeId?: string
  ): Promise<Payment>
  calculateChargeAmount(
    registrationId: string, 
    discountCodeId?: string, 
    userId?: string
  ): Promise<number>
}
```

## Data Models

### Core Models

#### AlternateRegistration (Game/Event)

```typescript
interface AlternateRegistration {
  id: string
  registrationId: string
  gameDescription: string
  gameDate?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}
```

#### UserAlternateRegistration (User's Interest in Registration)

```typescript
interface UserAlternateRegistration {
  id: string
  userId: string
  registrationId: string
  discountCodeId?: string
  createdAt: string
  updatedAt: string
}
```

#### AlternateSelection (User Selected for Game)

```typescript
interface AlternateSelection {
  id: string
  alternateRegistrationId: string
  userId: string
  discountCodeId?: string
  selectedBy: string
  paymentId?: string
  amountCharged: number
  selectedAt: string
}
```

#### RegistrationCaptain

```typescript
interface RegistrationCaptain {
  id: string
  registrationId: string
  userId: string
  assignedAt: string
  assignedBy: string
}
```

### Extended Models

#### User (Extended)

```typescript
interface User {
  // ... existing fields
  stripeSetupIntentId?: string
  stripePaymentMethodId?: string
  setupIntentStatus?: 'pending' | 'succeeded' | 'failed'
  paymentMethodUpdatedAt?: string
}
```

#### Registration (Extended)

```typescript
interface Registration {
  // ... existing fields
  allowAlternates: boolean
  alternatePrice?: number
  alternateAccountingCode?: string
}
```

## Error Handling

### Payment Failures

- **Setup Intent Failures**: Retry mechanism with user notification
- **Payment Method Expired**: Automatic notification to update payment method
- **Charge Failures**: Graceful handling with captain and alternate notification
- **Webhook Processing**: Idempotent processing with retry logic

### Business Logic Errors

- **Duplicate User Registrations**: Prevent multiple alternate registrations per user/registration (database constraint)
- **Duplicate Game Selections**: Prevent selecting same user twice for same game (database constraint + UI validation)
- **Invalid Captains**: Validate captain permissions before allowing game creation and alternate selection
- **Discount Limit Exceeded**: Calculate remaining discount and apply appropriately
- **Registration Conflicts**: Prevent alternates from registering as regular participants
- **Missing Pricing Configuration**: Validate that registration has alternate_price and alternate_accounting_code before allowing games

### Data Consistency

- **Transaction Boundaries**: Ensure payment and invoice creation are atomic
- **Webhook Synchronization**: Handle out-of-order webhook events
- **Cleanup Operations**: Proper cleanup when payment methods are removed

## Testing Strategy

### Unit Tests

- **Payment Calculation Logic**: Test discount application and limit checking
- **Setup Intent Management**: Test creation, confirmation, and cleanup
- **Permission Validation**: Test captain and admin access controls
- **Business Rules**: Test registration conflicts and validation logic

### Integration Tests

- **Stripe Integration**: Test Setup Intent and Payment Intent flows
- **Database Transactions**: Test payment flow with staging tables
- **Email Notifications**: Test LOOPS template integration
- **Webhook Processing**: Test Stripe webhook event handling

### End-to-End Tests

- **Complete Alternate Flow**: Register → Select → Charge → Notify
- **Payment Method Management**: Setup → Use → Remove
- **Captain Workflow**: Assign → View → Select alternates
- **Admin Management**: Configure registrations and manage captains

### Performance Tests

- **Concurrent Selections**: Test multiple captains selecting alternates simultaneously
- **Large Alternate Lists**: Test performance with many alternates per registration
- **Webhook Processing**: Test high-volume webhook processing

## Security Considerations

### Payment Security

- **PCI Compliance**: No card data stored locally, only Stripe payment method IDs
- **Webhook Verification**: Verify Stripe webhook signatures
- **Setup Intent Security**: Validate Setup Intent ownership before use

### Access Control

- **Captain Permissions**: Validate captain assignment before allowing alternate selection
- **Admin Restrictions**: Ensure only admins can assign captains and configure alternates
- **User Data Protection**: Ensure users can only access their own alternate registrations

### Data Privacy

- **Payment Method Display**: Show only last 4 digits and card type
- **Audit Logging**: Log all alternate selections and payment method changes
- **Data Retention**: Proper cleanup of expired Setup Intents and payment methods

## Environment Configuration

### Required Environment Variables

```bash
# LOOPS Email Templates
LOOPS_ALTERNATE_SELECTED_TEMPLATE_ID=tmpl_xxx
LOOPS_PAYMENT_AUTHORIZATION_REMOVED_TEMPLATE_ID=tmpl_xxx

# Stripe Configuration (existing)
STRIPE_SECRET_KEY=sk_xxx
STRIPE_PUBLISHABLE_KEY=pk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### Database Migrations

- Add new tables: `alternate_registrations` (games), `user_alternate_registrations` (user interest), `registration_captains`, `alternate_selections`
- Extend `registrations` table with alternate-specific fields (`allow_alternates`, `alternate_price`, `alternate_accounting_code`)
- Create appropriate indexes for performance
- Set up RLS policies for security
- Add unique constraints to prevent duplicate registrations and selections

## Monitoring and Analytics

### Key Metrics

- **Alternate Registration Rate**: Percentage of users registering as alternates
- **Selection Frequency**: How often alternates are selected per registration
- **Payment Success Rate**: Success rate of alternate charges
- **Setup Intent Completion**: Rate of successful payment method setup

### Logging Requirements

- **Payment Processing**: Log all alternate charges and failures
- **Setup Intent Events**: Log creation, confirmation, and failures
- **Captain Actions**: Log all alternate selections with context
- **System Events**: Log payment method removals and cleanup operations

### Error Monitoring

- **Stripe Integration**: Monitor Setup Intent and Payment Intent failures
- **Webhook Processing**: Track webhook processing errors and retries
- **Email Delivery**: Monitor LOOPS email delivery status
- **Database Operations**: Track transaction failures and rollbacks
