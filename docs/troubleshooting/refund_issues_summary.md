# Refund Issues - Diagnostic Summary

## Issues Found

### 1. ✅ FIXED: Discount Code Tracking for Future Refunds
**Status**: Fixed in code for future refunds, but existing credit notes won't show discount usage

**Problem**: Credit note line items didn't preserve `discount_code_id` from original invoice line items, so refunded discounts don't appear in the Discount Usage report.

**Evidence**: Query 2 shows all existing credit notes have `discount_code_id: null`

**Fix Applied**: Updated `/src/lib/xero/staging.ts` to preserve `discount_code_id` and `item_id` when creating credit note line items.

**Limitation**: Existing credit notes (created before this fix) won't show up in Discount Usage. Only NEW refunds will track discount usage properly.

---

### 2. ❌ NEEDS FIX: Payment Status Not Updated for Refunds
**Status**: Requires database update

**Problem**: Payments that have been refunded still have `status = 'completed'` instead of `status = 'refunded'`. This causes the financial report view to show incorrect amounts:
- For regular refunds: Shows as positive revenue instead of negative (e.g., CN-0048 shows +$325 instead of -$325)
- For zero-dollar refunds: Shows as double-negative (e.g., CN-0057 shows -$30 instead of $0 net)

**Evidence**:
- Query 3: `user_registrations.payment_status = 'refunded'` ✅
- Query 4: `payments.status = 'completed'` ❌
- The view gets payment_status from `payments.status`, not from `user_registrations.payment_status`

**Root Cause**: The refund processing code updates `user_registrations.payment_status` but not `payments.status`. For zero-dollar refunds, I added the fix in today's session, but regular refunds processed via Stripe webhook may not be updating payment status.

**Fix Required**:
1. Run the SQL script in `fix_refunded_payment_status.sql` to update existing refunded payments
2. Verify that Stripe webhook updates `payments.status = 'refunded'` for regular refunds
3. My earlier fix handles zero-dollar refunds going forward

---

### 3. ❓ UNCLEAR: "Unknown Registration" and "Unknown Season"
**Status**: Cannot reproduce with diagnostic data

**Problem**: You reported seeing "Unknown Registration" and "Unknown Season" for the two most recent refunds.

**Evidence**: Query 4 (the view that the API uses) shows:
- CN-0057: registration_name = "Scrimmage #10", season_name = "Fall/Winter 2025" ✅
- CN-0048: registration_name = "Rec League - Fall/Winter 2025-26", season_name = "Fall/Winter 2025" ✅
- CN-0045: registration_name = "Scrimmage #7", season_name = "Fall/Winter 2025" ✅
- CN-0041: registration_name = "Rec League - Fall/Winter 2025-26", season_name = "Fall/Winter 2025" ✅

**Possible Explanations**:
1. The issue was already fixed by previous changes
2. You're looking at a different date range that includes other credit notes
3. There's a display issue in the frontend
4. CN-0046 is missing from query 4 results (might be filtered out somehow)

**Next Steps**:
1. Check the financial report page again to see if you still see "Unknown Registration"
2. If yes, let me know which specific invoice numbers show as "Unknown"
3. Check what date range you're viewing

---

## Summary of Data Findings

### Credit Notes Created:
- **CN-0057** (2025-12-15): Zero-dollar refund for "Scrimmage #10", $0 total (-$30 registration + $30 discount)
- **CN-0048** (2025-12-14): Regular refund for "Rec League", $325
- **CN-0046** (2025-12-12): Regular refund for "Scrimmage #7", $30
- **CN-0045** (2025-12-12): Zero-dollar refund for "Scrimmage #7", $0 total
- **CN-0041** (2025-12-12): Zero-dollar refund for "Rec League - Alternate", $0 total

### Key Database Issues:
1. All credit notes have `payment_id` set correctly ✅
2. All credit note line items have `line_item_type` set correctly ✅
3. All credit notes join to `user_registrations` properly ✅
4. BUT: `discount_code_id` is NULL for existing credit notes ❌
5. BUT: `payments.status` is 'completed' instead of 'refunded' ❌

---

## Action Items

1. **Run SQL Fix**: Execute `fix_refunded_payment_status.sql` to update payment status for existing refunds
2. **Verify Webhook**: Check if Stripe webhook handler updates `payments.status = 'refunded'` for regular refunds
3. **Confirm Issue**: Check if "Unknown Registration" issue still exists after fixing payment status
4. **Accept Limitation**: Existing credit notes won't show discount usage (only new ones will)
