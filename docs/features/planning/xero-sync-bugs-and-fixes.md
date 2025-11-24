# Xero Batch Sync Bugs and Fixes

## Summary
Two critical bugs in the Xero batch sync caused:
1. Duplicate payments being marked as 'synced' when Xero rejected them
2. Invoices syncing to Xero but failing to update database, causing infinite retry loops (46+ duplicates)

## Root Causes

### Bug #1: Database Errors Silently Swallowed
**Location:** `markItemAsSynced()` (lines 1291-1295) and `markPaymentAsSynced()` (lines 1340-1344)

**Problem:**
```typescript
if (error) {
  console.error('❌ Error marking invoice as synced:', error)
  // ❌ Error logged but NOT thrown - execution continues!
}
```

**Impact:** Invoice syncs to Xero successfully, but database update fails silently. Cron job retries infinitely.

**Fix:** Throw the error so calling code knows the operation failed

---

### Bug #2: No Validation Error Checking in Payment Sync
**Location:** `syncXeroPayments()` (lines 1108-1152)

**Problem:**
```typescript
for (let i = 0; i < paymentsSynced.length; i++) {
  const xeroPayment = paymentsSynced[i]
  // ❌ NO check for hasErrors or validationErrors
  await this.markPaymentAsSynced(...)  // Marks as synced even if Xero rejected it!
}
```

**Impact:** Payments rejected by Xero (duplicates, validation errors) get marked as 'synced' anyway.

**Fix:** Check for `hasErrors` and `validationErrors` like invoice sync does

---

### Bug #3: Poor Error Handling in Payment Sync
**Location:** `syncXeroPayments()` catch block (lines 1156-1159)

**Problem:**
```typescript
} catch (error) {
  console.error('❌ Error syncing Xero payments:', error)
  return false  // ❌ Doesn't mark payments as failed in database
}
```

**Impact:** When Xero API fails, payments aren't marked as failed - they stay 'pending' and retry forever.

**Fix:** Parse error response Elements array and mark individual payments as failed

---

### Bug #4: Array Index Mismatch
**Location:** `syncXeroPayments()` (line 1108)

**Problem:**
```typescript
for (let i = 0; i < paymentsSynced.length; i++) {
  const originalRecord = paymentRecords[i]  // ❌ Assumes same length
}
```

**Impact:** If Xero rejects some payments, response array is shorter than request, causing misalignment.

**Fix:** Validate array lengths match or use safer correlation method

---

## Recommended Fixes

### Fix #1: Throw Database Errors (CRITICAL)

**File:** `src/lib/xero/batch-sync-xero.ts`

**In `markItemAsSynced()` (line 1291):**
```typescript
if (error) {
  console.error('❌ Error marking invoice as synced:', error)

  // ✅ Report to Sentry as fatal error
  Sentry.captureException(error, {
    level: 'fatal',
    tags: {
      component: 'xero-batch-sync',
      operation: 'mark_invoice_synced',
      critical: 'true'
    },
    extra: {
      stagingId,
      xeroId,
      invoiceNumber: number,
      tenantId,
      errorMessage: error.message,
      errorCode: error.code
    }
  })

  throw new Error(`Failed to mark invoice as synced: ${error.message}`)  // ✅ THROW ERROR
}
```

**In `markPaymentAsSynced()` (line 1340):**
```typescript
if (error) {
  console.error('❌ Error marking payment as synced:', error)

  // ✅ Report to Sentry as fatal error
  Sentry.captureException(error, {
    level: 'fatal',
    tags: {
      component: 'xero-batch-sync',
      operation: 'mark_payment_synced',
      critical: 'true'
    },
    extra: {
      stagingId,
      xeroPaymentId,
      tenantId,
      errorMessage: error.message,
      errorCode: error.code
    }
  })

  throw new Error(`Failed to mark payment as synced: ${error.message}`)  // ✅ THROW ERROR
}
```

---

### Fix #2: Add Validation Error Checking to Payment Sync

**File:** `src/lib/xero/batch-sync-xero.ts`

**In `syncXeroPayments()` - replace lines 1108-1152:**
```typescript
// Use array index to correlate request with response
for (let i = 0; i < paymentsSynced.length; i++) {
  const xeroPayment = paymentsSynced[i]
  const originalRecord = paymentRecords[i]

  if (!originalRecord) {
    console.error(`❌ No original payment record found for response index ${i}`)
    continue
  }

  // ✅ CHECK FOR VALIDATION ERRORS (like invoice sync does)
  if (xeroPayment.hasErrors || (xeroPayment.validationErrors && xeroPayment.validationErrors.length > 0)) {
    const errorMessages = xeroPayment.validationErrors?.map(e => e.message).join('; ') || 'Unknown validation error'
    console.error(`❌ Payment validation failed for record ${originalRecord.id}:`, errorMessages)

    // Mark payment as failed
    await this.markPaymentAsFailed(
      originalRecord.id,
      `Xero validation error: ${errorMessages}`
    )

    // Log failure
    await logXeroSync({
      tenant_id: tenantId,
      operation: 'payment_sync',
      record_type: 'payment',
      record_id: originalRecord.id,
      success: false,
      details: `Payment sync failed: ${errorMessages}`,
      response_data: {
        validationErrors: xeroPayment.validationErrors,
        payment: xeroPayment
      },
      request_data: {
        payment: xeroPayments[i]
      }
    })

    continue  // Skip to next payment
  }

  // Only mark as synced if NO errors
  await this.markPaymentAsSynced(
    originalRecord.id,
    xeroPayment.paymentID!,
    tenantId
  )

  // Log success (existing code)
  await logXeroSync({ ... })
}
```

---

### Fix #3: Better Error Handling in Payment Sync Catch Block

**File:** `src/lib/xero/batch-sync-xero.ts`

**In `syncXeroPayments()` - replace lines 1156-1159:**
```typescript
} catch (error: any) {
  console.error('❌ Error syncing Xero payments:', error)

  // Parse error response (Xero SDK may wrap errors)
  let parsedError = error
  if (typeof error === 'string') {
    try {
      parsedError = JSON.parse(error)
    } catch (e) {
      parsedError = error
    }
  }

  const errorBody = parsedError?.response?.body || parsedError?.body || parsedError

  // ✅ CHECK FOR ELEMENTS ARRAY (like invoice sync does)
  if (errorBody?.Elements && Array.isArray(errorBody.Elements)) {
    console.log('📋 Processing individual payment errors from Xero batch response')

    for (let i = 0; i < errorBody.Elements.length; i++) {
      const element = errorBody.Elements[i]
      const originalRecord = paymentRecords[i]

      if (!originalRecord) {
        console.error(`❌ No original record found for element index ${i}`)
        continue
      }

      const validationErrors = element.ValidationErrors || []
      if (validationErrors.length > 0) {
        const errorMessages = validationErrors.map((e: any) => e.Message).join('; ')
        console.error(`❌ Payment validation failed for record ${originalRecord.id}:`, errorMessages)

        await this.markPaymentAsFailed(
          originalRecord.id,
          `Xero validation error: ${errorMessages}`
        )

        await logXeroSync({
          tenant_id: tenantId,
          operation: 'payment_sync',
          record_type: 'payment',
          record_id: originalRecord.id,
          success: false,
          details: `Payment sync failed: ${errorMessages}`,
          response_data: { validationErrors, payment: element },
          request_data: { payment: xeroPayments[i] }
        })
      } else {
        // Payment succeeded - mark as synced
        const xeroPaymentId = element.PaymentID
        if (xeroPaymentId && xeroPaymentId !== '00000000-0000-0000-0000-000000000000') {
          await this.markPaymentAsSynced(originalRecord.id, xeroPaymentId, tenantId)
          await logXeroSync({
            tenant_id: tenantId,
            operation: 'payment_sync',
            record_type: 'payment',
            record_id: originalRecord.id,
            success: true,
            details: `Payment synced successfully`,
            response_data: { payment: element }
          })
        }
      }
    }
  } else {
    // Generic error - mark all payments as failed
    const errorMessage = error?.message || error?.response?.statusText || 'Unknown error'
    console.error('❌ Batch payment sync error:', errorMessage)

    for (const record of paymentRecords) {
      await this.markPaymentAsFailed(
        record.id,
        `Batch sync error: ${errorMessage}`
      )
    }
  }

  return false
}
```

---

## Testing Plan

1. **Test database error handling:**
   - Temporarily break database connection
   - Trigger sync
   - Verify error is thrown (not swallowed)
   - Verify sync doesn't retry infinitely

2. **Test duplicate payment rejection:**
   - Create duplicate payment in Xero manually
   - Trigger sync
   - Verify payment marked as 'failed' (not 'synced')
   - Verify error message indicates duplicate

3. **Test partial failures:**
   - Send batch with valid + invalid payments
   - Verify valid ones marked 'synced'
   - Verify invalid ones marked 'failed'

4. **Test infinite retry prevention:**
   - Simulate constraint error
   - Verify record marked as 'failed'
   - Verify cron doesn't retry indefinitely

---

## Migration Checklist

- [ ] Apply Fix #1 (throw database errors)
- [ ] Apply Fix #2 (validation error checking)
- [ ] Apply Fix #3 (better error handling)
- [ ] Test in development
- [ ] Monitor logs for error patterns
- [ ] Deploy to production
- [ ] Monitor Xero sync success rate
