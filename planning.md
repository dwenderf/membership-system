# Membership System Planning

## Pending Features & Improvements

### Database Architecture Cleanup - Remove payment_items Table
**Priority: HIGH** - Currently causing production errors

**Problem**: The `payment_items` table is redundant and out of sync with `xero_invoice_line_items`, which is the real source of truth for transaction details. This is causing constraint violations when donations are processed.

**Solution**: Remove `payment_items` table entirely and update all code to use `xero_invoice_line_items` as the single source of truth.

**Files to Update**:
1. **API Routes** (remove payment_items INSERT operations):
   - `/api/create-payment-intent/route.ts` - Lines 229-231, 658-660
   - `/api/create-registration-payment-intent/route.ts` - Remove payment_items inserts

2. **Library Files** (update to read from xero_invoice_line_items):
   - `payment-completion-processor.ts` - Lines 364-368 (change JOIN from payment_items to xero_invoice_line_items)
   - `xero-staging.ts` - Lines 372-376 (change JOIN from payment_items to xero_invoice_line_items)

3. **Database Changes**:
   - Create migration to drop `payment_items` table
   - Update schema.sql to remove table definition
   - Remove any foreign key references

4. **Testing**:
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
- **Multiple Item Purchasing for Events**: Allow users to purchase multiple items from multiple categories for events (e.g., both "Lunch" and "Drinks" for a social event)
  - Teams should remain single-category only (one registration per team)
  - Events should support multiple items per category with admin-configurable limits
  - Admin interface needs option to set per-category purchase limits (e.g., max 3 lunch items per user)
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