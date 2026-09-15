import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'
import { logger } from '@/lib/logging/logger'

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

      const discountAmount = discountValidation.discountAmount || 0

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