# Membership System Planning

## Recently Completed Features ✅

### Xero Integration Improvements
- **Manual Xero Sync Retry**: Admin can manually retry failed Xero invoice syncs from the admin interface
- **Smart Sync Filtering**: Only sync zero-value invoices or invoices with completed payments (prevents DRAFT invoices)
- **Improved Invoice Status Logic**: All synced invoices marked as AUTHORISED in database, not DRAFT
- **Better Error Handling**: Failed syncs remain pending when Xero is disconnected, not marked as failed
- **Admin UI Filtering**: Failed sync items only show retryable invoices (filtered by payment status and amount)
- **Correct Invoice Dates**: Use actual invoice creation date instead of current date for Xero sync

### User Invoice Management
- **My Invoices Tab**: Users can view all their invoices in a dedicated tab with badge showing unpaid count
- **Invoice Detail Pages**: Internal invoice viewer showing line items, totals, and payment status
- **Xero Payment Links**: Direct links to Xero invoices for payment (admin URLs)
- **Unpaid Invoice Warnings**: Dashboard shows warnings for unpaid invoices
- **Invoice Sorting**: Unpaid invoices shown first, then by creation date descending

### User Profile Enhancements
- **LGBTQ Attribute**: Added `isLgbtq` boolean field to users table (nullable)
- **Goalie Attribute**: Added `isGoalie` boolean field to users table (required)
- **Profile Editing**: Users can update their attributes via dedicated edit page
- **Member Tags**: Display LGBTQ and goalie status as color-coded tags in account page
- **Onboarding Integration**: Collect LGBTQ and goalie status during user onboarding

### Registration System Improvements
- **LGBTQ Pre-sale Access**: LGBTQ members can register during pre-sale without a code
- **Pre-sale Code Uppercase**: Force pre-sale codes to uppercase for consistency
- **Admin Configuration**: Checkbox in admin to enable/disable LGBTQ pre-sale access per registration
- **User Experience**: Special messaging for LGBTQ users during pre-sale periods

### Technical Improvements
- **Sentry Modernization**: Updated to latest Sentry SDK with proper error handling
- **Build Optimizations**: Fixed build errors and linter warnings
- **API Endpoint Organization**: Moved unpaid invoices API to proper location
- **TypeScript Types**: Updated database types for new user attributes

### Refund Processing System ✅
- **Complete Staging Workflow**: Implemented staging-first approach for credit note creation instead of direct Xero API calls
- **Proportional Line Item Allocation**: Credit notes maintain proper accounting structure with positive/negative line items (e.g., $30 charge + (-$1 discount) = $29 credit)
- **Enhanced Admin UI**: Improved invoice history display with proper credit note vs invoice labeling and detailed refund history
- **Xero Integration**: Full credit note sync with payment allocation showing credits as "applied" in Xero
- **Database Consistency**: Unified refund processing with proper currency handling and exact ID mapping
- **UI/UX Improvements**: Clean admin interface with credit note line items, refund status tracking, and consolidated user views

## Pending Features & Improvements

### Enhanced Refund System - Two-Type Refund Processing 🚧
**Status**: UI Foundation Complete, API Endpoints Needed

**Problem**: Current refund system only supports proportional refunds, but admins need to handle two distinct use cases:
1. **Standard Refunds**: Injuries, accidental purchases, cancellations (proportional refund)
2. **Discount Application**: User forgot to apply discount code at purchase time (retroactive discount)

**Solution**: Enhanced RefundModal with two refund types and improved technical architecture.

#### ✅ Completed: UI Foundation
- **RefundModal Enhancement**: Added radio button selection for "Proportional Refund" vs "Apply Discount Code"
- **Conditional Forms**: Different input fields based on selected refund type
- **Real-time Validation Framework**: Foundation for discount code validation with preview
- **Enhanced State Management**: All necessary state variables for both workflows
- **Preview Functionality**: Shows discount details, refund amount, and partial discount messages

#### 🚧 Remaining Implementation:

**API Endpoints Needed:**
```typescript
// Adapt existing discount validation for refund context
POST /api/validate-discount-code-refund
{
  code: string,
  paymentId: string,    // Instead of registrationId
  amount: number        // Original payment amount
}

// Enhanced refund creation with immediate staging
POST /api/admin/refunds
{
  type: 'proportional' | 'discount_code',
  paymentId: string,
  amount?: number,      // For proportional refunds
  discountCode?: string, // For discount code refunds
  reason: string
}
// Response includes xero_invoices.id for exact webhook mapping
```

**Backend Enhancements:**

1. **Discount Validation for Refunds** (`/src/app/api/validate-discount-code-refund/route.ts`):
   - Adapt existing `/api/validate-discount-code` logic for refund context
   - Determine season from payment/invoice instead of registration
   - Maintain season usage limits and partial discount logic
   - Return discount amount, accounting code, and category details

2. **Enhanced Staging System** (`/src/lib/xero/staging.ts`):
   ```typescript
   // New method for discount-based credit notes
   async createDiscountCreditNoteStaging(
     refundId: string,
     paymentId: string,
     discountCode: DiscountCode,
     refundAmountCents: Cents
   ): Promise<{success: boolean, xeroInvoiceId?: string}>
   
   // Single line item with discount details instead of proportional allocation
   lineItems = [{
     description: `Discount Applied: ${discountCode.code} - ${discountCode.category.name}`,
     line_amount: -discountCode.amount, // Negative for discount
     account_code: discountCode.accounting_code,
     discount_code_id: discountCode.id
   }]
   ```

3. **Immediate Staging Architecture**:
   - Create credit note staging records immediately when admin submits refund
   - Mark as `sync_status: 'staged'` with full metadata
   - Include `xero_invoice_id` in refund metadata for exact webhook mapping
   - Eliminates search-and-match issues in webhook processing

4. **Simplified Webhook Processing** (`/src/app/api/stripe-webhook/route.ts`):
   ```typescript
   // Direct lookup instead of payment_id searching
   const xeroInvoiceId = refund.metadata?.xero_invoice_id
   if (xeroInvoiceId) {
     await supabase
       .from('xero_invoices')
       .update({ sync_status: 'pending' })
       .eq('id', xeroInvoiceId)
   }
   ```

**Benefits:**
- **Exact ID Mapping**: Eliminates constraint violations and search ambiguity
- **Two Clear Use Cases**: Addresses real-world admin needs
- **Preview Before Submit**: Admins see exactly what will happen
- **Reuses Existing Logic**: Leverages proven discount validation system
- **Improved Reliability**: Immediate staging + exact mapping = fewer edge cases

**Files to Create/Modify:**
- `✅ /src/app/admin/reports/users/[id]/invoices/[invoiceId]/RefundModal.tsx` - Enhanced UI
- `🚧 /src/app/api/validate-discount-code-refund/route.ts` - New validation endpoint
- `🚧 /src/lib/xero/staging.ts` - Add `createDiscountCreditNoteStaging` method
- `🚧 /src/app/api/admin/refunds/route.ts` - Update to handle both refund types
- `🚧 /src/app/api/stripe-webhook/route.ts` - Simplify with exact ID mapping

### Database Architecture Cleanup - Remove payment_items Table
**Priority: HIGH** - Currently causing production errors

**Problem**: The `payment_items` table is redundant and out of sync with `xero_invoice_line_items`, which is the real source of truth for transaction details. This is causing constraint violations when donations are processed.

**Solution**: Remove `payment_items` table entirely and update all code to use `xero_invoice_line_items` as the single source of truth.

**Files to Update**:1. **API Routes** (remove payment_items INSERT operations):
   - `/api/create-membership-payment-intent/route.ts` - Lines229-231658
   - `/api/create-registration-payment-intent/route.ts` - Remove payment_items inserts

2 **Library Files** (update to read from xero_invoice_line_items):
   - `payment-completion-processor.ts` - Lines 364 (change JOIN from payment_items to xero_invoice_line_items)
   - `xero-staging.ts` - Lines 372 (change JOIN from payment_items to xero_invoice_line_items)

3. **Database Changes**:
   - Create migration to drop `payment_items` table
   - Update schema.sql to remove table definition
   - Remove any foreign key references

4 **Testing**:
   - Ensure payment completion still works correctly
   - Verify Xero staging system continues to function
   - Test both paid and free transactions

**Benefits**:
- Eliminates data redundancy and sync issues
- Fixes immediate production constraint violation
- Simplifies codebase by using single source of truth
- Makes xero_invoice_line_items the authoritative transaction record
- Aligns with future vision of generic accounting tables

### Event Registration Enhancements
- **Multiple Item Purchasing for Events**: Allow users to purchase multiple items from multiple categories for events (e.g., both "Lunchand "Drinks" for a social event)
  - Teams should remain single-category only (one registration per team)
  - Events should support multiple items per category with admin-configurable limits
  - Admin interface needs option to set per-category purchase limits (e.g., max3nch items per user)
  - Update browse-registrations filtering to properly handle events vs teams distinction
  - Modify user_registrations table to support quantity field for events
  - Update RegistrationPurchase component to handle quantity selection for events

### Database Schema Changes Needed
- Add `quantity` field to `user_registrations` table for events
- Add `max_per_user` field to `registration_categories` table for admin limits
- Ensure proper constraints to prevent over-purchasing

### UI/UX Improvements
- Browse-registrations page should show events even after partial registration (with available categories)
- Show quantity selector for event categories
- Display purchase limits clearly to users
- Better messaging for "already registered" states between teams and events

### Future Enhancements
- **Public Xero Invoice Links**: Generate public-facing Xero invoice links for customers (requires manual setup in Xero)
- **Enhanced Payment Tracking**: Better integration between Stripe payments and Xero invoice status
- **Bulk Operations**: Admin tools for bulk invoice/payment operations
- **Advanced Filtering**: More sophisticated filtering options for admin invoice management