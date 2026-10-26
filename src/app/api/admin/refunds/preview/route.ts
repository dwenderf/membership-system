import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'
import { logger } from '@/lib/logging/logger'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'
import { findOriginalInvoice, resolvePaymentSeasonId, checkDiscountCodeReuse, reusedCodeError, reuseLookupFailedError, MISSING_ORIGINAL_INVOICE_ERROR } from '@/lib/refunds/discount-refund-guards'

// POST /api/admin/refunds/preview - Preview refund line items and amounts
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Check if current user is admin
  const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request body
  const body = await request.json()
  const { paymentId, refundType, amount, discountValidation } = body

    // Validate required fields
    if (!paymentId || !refundType) {
      return NextResponse.json({
        error: 'Payment ID and refund type are required'
      }, { status: 400 })
    }

    // Get payment details for validation
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      logger.logPaymentProcessing('refund-preview-payment-not-found', 'Payment not found for refund preview', { paymentId, error: paymentError?.message }, 'warn')
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Validate payment status
    if (payment.status !== 'completed') {
      return NextResponse.json({
        error: 'Can only refund completed payments'
      }, { status: 400 })
    }

    // Check if this is a registration payment (to allow zero-dollar refunds for free registrations)
    const { data: registrations } = await supabase
      .from('user_registrations')
      .select('id')
      .eq('payment_id', paymentId)
    const isRegistrationPayment = registrations && registrations.length > 0

    // Check available refund amount
    const { data: existingRefunds } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', paymentId)
      .in('status', ['completed', 'processing', 'pending'])

  const totalExistingRefunds = existingRefunds?.reduce((sum, refund) => sum + refund.amount, 0) || 0
  const availableForRefund = payment.final_amount - totalExistingRefunds

  let refundData

    if (refundType === 'proportional') {
      // Allow zero-dollar refunds for registration payments (to cancel free registrations)
      const minAllowed = isRegistrationPayment ? 0 : 0.01
      if (amount === null || amount === undefined || amount < minAllowed) {
        return NextResponse.json({
          error: 'Positive refund amount required for proportional refunds'
        }, { status: 400 })
      }

      const amountInCents = Math.round(amount * 100)

      if (amountInCents > availableForRefund) {
        return NextResponse.json({
          error: `Cannot refund $${amount.toFixed(2)}. Only $${(availableForRefund / 100).toFixed(2)} available.`
        }, { status: 400 })
      }

      // For zero-dollar refunds, still create Xero staging (credit notes can be $0)
      // Zero-dollar credit notes will sync to Xero just like zero-dollar invoices do
      refundData = {
        amount: centsToCents(amountInCents)
      }

    } else if (refundType === 'discount_code') {
      if (!discountValidation?.isValid) {
        return NextResponse.json({
          error: 'Valid discount code validation required'
        }, { status: 400 })
      }

      const discountCodeId = discountValidation.discountCode?.id
      const discountCodeLabel = discountValidation.discountCode?.code || 'This discount code'
      if (!discountCodeId) {
        return NextResponse.json({ error: 'Valid discount code validation required' }, { status: 400 })
      }

      // #454: re-check on the server before anything is staged. The client-sent amount is still
      // trusted (decision (c)); these checks only stop a missing invoice or a reused code.
      const invoiceCheck = await findOriginalInvoice(supabase, paymentId)
      if (invoiceCheck.status !== 'ok') {
        logger.logPaymentProcessing('refund-preview-original-invoice-missing', 'Original invoice missing or ambiguous for discount refund preview', { paymentId, status: invoiceCheck.status }, 'warn')
        return NextResponse.json({
          error: invoiceCheck.status === 'multiple' ? 'Multiple original invoices found for payment' : MISSING_ORIGINAL_INVOICE_ERROR,
          missingOriginalInvoice: invoiceCheck.status === 'missing'
        }, { status: 400 })
      }

      const reuse = await checkDiscountCodeReuse(supabase, paymentId, invoiceCheck.invoiceId, discountCodeId)
      if (reuse.status !== 'unused') {
        logger.logPaymentProcessing('refund-preview-discount-code-rejected', 'Discount code rejected in refund preview', { paymentId, discountCodeId, status: reuse.status }, 'warn')
        const error = reuse.status === 'reused'
          ? reusedCodeError(discountCodeLabel, reuse.source)
          : reuse.status === 'multiple'
            ? 'Multiple discount line items found on original invoice'
            : reuseLookupFailedError(discountCodeLabel)
        return NextResponse.json({
          error,
          alreadyApplied: reuse.status === 'reused',
          reuseCheckFailed: reuse.status === 'error'
        }, { status: reuse.status === 'error' ? 503 : 400 })
      }

      const discountAmount = discountValidation.discountAmount || 0

      // Re-check the customer's seasonal limit on the server so the client can't bypass it. Usage
      // already counts this invoice's discounts and earlier refund credit notes.
      if (discountAmount > 0) {
        const season = await resolvePaymentSeasonId(supabase, paymentId)
        if (season.status !== 'ok') {
          logger.logPaymentProcessing('refund-preview-season-unresolved', 'Could not determine the season for a discount refund preview', { paymentId, status: season.status }, season.status === 'error' ? 'error' : 'warn')
          return NextResponse.json({
            error: season.status === 'error'
              ? "Couldn't check the customer's seasonal discount limit. Try again."
              : "Couldn't determine the season for this payment, so the seasonal discount limit can't be checked."
          }, { status: season.status === 'error' ? 503 : 400 })
        }
        let limit
        try {
          limit = await checkSeasonalDiscountLimit(supabase, payment.user_id, discountCodeId, season.seasonId, discountAmount)
        } catch (limitError) {
          logger.logPaymentProcessing('refund-preview-season-limit-error', 'Seasonal discount limit check failed for refund preview', { paymentId, discountCodeId, error: limitError instanceof Error ? limitError.message : String(limitError) }, 'error')
          return NextResponse.json({ error: "Couldn't check the customer's seasonal discount limit. Try again." }, { status: 503 })
        }
        if (limit.isEligible === false || limit.isAtLimit || limit.finalAmount < discountAmount) {
          logger.logPaymentProcessing('refund-preview-season-limit-exceeded', 'Discount refund exceeds the customer\'s seasonal limit', { paymentId, discountCodeId, discountAmount, allowed: limit.finalAmount, isAtLimit: limit.isAtLimit, isEligible: limit.isEligible }, 'warn')
          const max = limit.seasonalUsage?.maxAllowed
          return NextResponse.json({
            error: limit.isEligible === false
              ? `${discountCodeLabel} isn't available to this customer's account.`
              : limit.isAtLimit
                ? `This customer has already reached their${max ? ` $${(max / 100).toFixed(2)}` : ''} season limit for this discount category.`
                : `Discount amount $${(discountAmount / 100).toFixed(2)} exceeds the customer's remaining seasonal discount of $${(limit.finalAmount / 100).toFixed(2)}. Re-validate the code.`,
            seasonalLimitExceeded: true
          }, { status: 400 })
        }
      }

      if (discountAmount > availableForRefund) {
        return NextResponse.json({
          error: `Discount amount $${(discountAmount / 100).toFixed(2)} exceeds available refund amount $${(availableForRefund / 100).toFixed(2)}`
        }, { status: 400 })
      }

      refundData = {
        discountCode: discountValidation.discountCode.code,
        discountCodeId: discountValidation.discountCode.id,
        discountAmount: centsToCents(discountAmount),
        discountAccountingCode: discountValidation.discountCode.category.accounting_code,
        discountCategoryName: discountValidation.discountCode.category.name,
        discountCategoryId: discountValidation.discountCode.category.id
      }

    } else {
      return NextResponse.json({
        error: 'Invalid refund type. Must be "proportional" or "discount_code"'
      }, { status: 400 })
    }

    // Create Xero staging records only (no refund table record until submission)
    // The refund table record will be created when user confirms the refund
    const stagingId = await xeroStagingManager.createRefundStaging(
      null, // No refund ID during preview - will be set during confirmation
      paymentId,
      refundType,
      refundData
    )

    if (!stagingId) {
      logger.logPaymentProcessing('refund-preview-staging-failed', 'Failed to create refund staging records', { paymentId, refundType }, 'error')
      return NextResponse.json({
        error: 'Failed to create staging records. This may be because the original invoice has not been synced to Xero yet, or there was an issue with the payment record.'
      }, { status: 500 })
    }

    // Get the actual staged line items to show to admin
    const { data: stagedInvoice } = await supabase
      .from('xero_invoices')
      .select(`
        id,
        total_amount,
        invoice_type,
        sync_status,
        xero_invoice_line_items (
          description,
          line_amount,
          account_code,
          tax_type
        )
      `)
      .eq('id', stagingId)
      .single()

    return NextResponse.json({
      success: true,
      staging: {
        refund_id: null, // No refund record created during preview
        staging_id: stagingId,
        refund_type: refundType,
        total_amount: stagedInvoice?.total_amount || 0,
        line_items: stagedInvoice?.xero_invoice_line_items || [],
        payment_info: {
          payment_id: paymentId,
          original_amount: payment.final_amount,
          available_for_refund: availableForRefund
        },
        discount_info: refundType === 'discount_code' ? {
          code: discountValidation.discountCode.code,
          category: discountValidation.discountCode.category.name,
          percentage: discountValidation.discountCode.percentage,
          is_partial: discountValidation.isPartialDiscount || false,
          partial_message: discountValidation.partialDiscountMessage
        } : undefined
      }
    })

  } catch (error) {
    logger.logPaymentProcessing('refund-preview-exception', 'Unexpected error generating refund preview', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Failed to generate refund preview' }, { status: 500 })
  }
}
