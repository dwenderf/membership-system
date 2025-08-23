# Design Document

## Overview

The alternate registration system extends the existing hockey membership and registration platform to support alternate players who can be selected by captains for specific games throughout a season. The system uses Stripe Setup Intents to securely store payment methods without pre-authorization, allowing on-demand charging when alternates are selected. The design integrates seamlessly with the existing payment flow, Xero synchronization, and email notification systems.

## Architecture

### High-Level Flow
1. **Registration Phase**: Members register as alternates with optional discount codes and Setup Intent creation
2. **Captain Management**: Captains view and select alternates for specific games with descriptions
3. **Payment Processing**: System charges saved payment methods and creates invoices through existing staging flow
4. **Notification**: Email notifications sent via LOOPS templates
5. **Xero Sync**: Invoice and payment data synchronized to Xero accounting system

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
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    discount_code_id UUID REFERENCES discount_codes(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, registration_id)
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
    selected_by UUID NOT NULL REFERENCES users(id), -- Captain or admin who selected
    game_description TEXT NOT NULL,
    payment_id UUID REFERENCES payments(id), -- Links to payment record
    amount_charged INTEGER NOT NULL, -- Amount in cents
    selected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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

#### Alternate Registration Management
- `POST /api/alternate-registrations` - Register as alternate
- `DELETE /api/alternate-registrations/{id}` - Cancel alternate registration
- `GET /api/user/alternate-registrations` - Get user's alternate registrations
- `POST /api/alternate-registrations/{id}/setup-intent` - Create/update Setup Intent

#### Captain Management
- `GET /api/registrations/{id}/alternates` - Get alternates list for captains
- `POST /api/registrations/{id}/select-alternate` - Select alternate for game
- `GET /api/captain/registrations` - Get registrations where user is captain

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
    alternateId: string, 
    amount: number, 
    description: string,
    discountCode?: string
  ): Promise<Payment>
  calculateChargeAmount(
    basePrice: number, 
    discountCode?: string, 
    userId?: string
  ): Promise<number>
}
```

## Data Models

### Core Models

#### AlternateRegistration
```typescript
interface AlternateRegistration {
  id: string
  userId: string
  registrationId: string
  discountCodeId?: string
  createdAt: string
  updatedAt: string
}
```

#### AlternateSelection
```typescript
interface AlternateSelection {
  id: string
  alternateRegistrationId: string
  selectedBy: string
  gameDescription: string
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
- **Duplicate Registrations**: Prevent multiple alternate registrations per user/registration
- **Invalid Captains**: Validate captain permissions before allowing alternate selection
- **Discount Limit Exceeded**: Calculate remaining discount and apply appropriately
- **Registration Conflicts**: Prevent alternates from registering as regular participants

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
- Add new tables: `alternate_registrations`, `registration_captains`, `alternate_selections`
- Extend `registrations` table with alternate-specific fields
- Create appropriate indexes for performance
- Set up RLS policies for security

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