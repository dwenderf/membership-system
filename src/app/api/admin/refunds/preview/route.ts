import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'

// POST /api/admin/refunds/preview - Preview refund line items and amounts
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  console.log('[refunds/preview] POST called')

  try {
    // Check if current user is admin
  const { data: { user: authUser } } = await supabase.auth.getUser()
  console.log('[refunds/preview] Auth user:', authUser)
    
    if (!authUser) {
      console.warn('[refunds/preview] Unauthorized: no auth user')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()
    console.log('[refunds/preview] Current user:', currentUser)

    if (!currentUser?.is_admin) {
      console.warn('[refunds/preview] Forbidden: user is not admin')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request body
  const body = await request.json()
  console.log('[refunds/preview] Request body:', body)
  const { paymentId, refundType, amount, discountValidation } = body

    // Validate required fields
    if (!paymentId || !refundType) {
      console.warn('[refunds/preview] Missing paymentId or refundType:', { paymentId, refundType })
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
    console.log('[refunds/preview] Payment:', payment)
    if (paymentError) console.error('[refunds/preview] Payment error:', paymentError)

    if (paymentError || !payment) {
      console.warn('[refunds/preview] Payment not found:', { paymentError, payment })
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Validate payment status
    if (payment.status !== 'completed') {
      console.warn('[refunds/preview] Payment not completed:', payment.status)
      return NextResponse.json({ 
        error: 'Can only refund completed payments' 
      }, { status: 400 })
    }

    // Check available refund amount
    const { data: existingRefunds } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', paymentId)
      .in('status', ['completed', 'processing', 'pending'])
    console.log('[refunds/preview] Existing refunds:', existingRefunds)

  const totalExistingRefunds = existingRefunds?.reduce((sum, refund) => sum + refund.amount, 0) || 0
  const availableForRefund = payment.final_amount - totalExistingRefunds
  console.log('[refunds/preview] Available for refund:', availableForRefund)

  let refundData

    if (refundType === 'proportional') {
      if (!amount || amount <= 0) {
        console.warn('[refunds/preview] Invalid amount for proportional refund:', amount)
        return NextResponse.json({ 
          error: 'Positive refund amount required for proportional refunds' 
        }, { status: 400 })
      }

      const amountInCents = Math.round(amount * 100)
      console.log('[refunds/preview] Proportional refund amount in cents:', amountInCents)
      
      if (amountInCents > availableForRefund) {
        console.warn('[refunds/preview] Refund amount exceeds available:', { amountInCents, availableForRefund })
        return NextResponse.json({ 
          error: `Cannot refund $${amount.toFixed(2)}. Only $${(availableForRefund / 100).toFixed(2)} available.` 
        }, { status: 400 })
      }

      refundData = {
        amount: centsToCents(amountInCents)
      }

    } else if (refundType === 'discount_code') {
      if (!discountValidation?.isValid) {
        console.warn('[refunds/preview] Invalid discount code validation:', discountValidation)
        return NextResponse.json({ 
          error: 'Valid discount code validation required' 
        }, { status: 400 })
      }

      const discountAmount = discountValidation.discountAmount || 0
      console.log('[refunds/preview] Discount amount:', discountAmount)
      
      if (discountAmount > availableForRefund) {
        console.warn('[refunds/preview] Discount amount exceeds available:', { discountAmount, availableForRefund })
        return NextResponse.json({ 
          error: `Discount amount $${(discountAmount / 100).toFixed(2)} exceeds available refund amount $${(availableForRefund / 100).toFixed(2)}` 
        }, { status: 400 })
      }

      refundData = {
        discountCode: discountValidation.discountCode.code,
        discountAmount: centsToCents(discountAmount),
        discountAccountingCode: discountValidation.discountCode.category.accounting_code,
        discountCategoryName: discountValidation.discountCode.category.name
      }

    } else {
      console.warn('[refunds/preview] Invalid refund type:', refundType)
      return NextResponse.json({ 
        error: 'Invalid refund type. Must be "proportional" or "discount_code"' 
      }, { status: 400 })
    }

    // Create staging records that will be used for the actual refund
    // First create a refund record to get ID for staging
    const refundAmount = refundData.amount || refundData.discountAmount || 0
    
    // Ensure amount is positive (required by DB constraint)
    if (refundAmount <= 0) {
      return NextResponse.json({ 
        error: 'Refund amount must be greater than 0' 
      }, { status: 400 })
    }

    const { data: refundRecord, error: insertError } = await supabase
      .from('refunds')
      .insert({
        payment_id: paymentId,
        user_id: payment.user_id,
        amount: refundAmount,
        reason: `Staged ${refundType} refund`, // Will be updated when confirmed
        status: 'pending', // Valid status - will remain pending until confirmed
        processed_by: authUser.id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[refunds/preview] Failed to create refund record:', insertError)
      return NextResponse.json({ 
        error: 'Failed to create refund staging record' 
      }, { status: 500 })
    }

    console.log('[refunds/preview] Created refund record:', refundRecord.id)

    // Create staging records using the refund ID
    console.log('[refunds/preview] Calling xeroStagingManager.createRefundStaging', { refundId: refundRecord.id, paymentId, refundType, refundData })
    const stagingId = await xeroStagingManager.createRefundStaging(
      refundRecord.id,
      paymentId,
      refundType,
      refundData
    )
    console.log('[refunds/preview] Staging result:', stagingId)

    if (!stagingId) {
      // Clean up the refund record if staging failed
      await supabase
        .from('refunds')
        .delete()
        .eq('id', refundRecord.id)
        
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

    console.log('[refunds/preview] Success, returning staging response')
    return NextResponse.json({
      success: true,
      staging: {
        refund_id: refundRecord.id,
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
    console.error('[refunds/preview] Exception:', error)
    return NextResponse.json({ error: 'Failed to generate refund preview' }, { status: 500 })
  }
}