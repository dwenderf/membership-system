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

## Pending Features & Improvements

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