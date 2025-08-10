import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import { processRefundWithXero } from '@/lib/xero/credit-notes'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

// POST /api/admin/refunds - Process new refunds
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

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
    const { paymentId, amount, reason } = body

    // Validate required fields
    if (!paymentId || !amount || amount <= 0) {
      return NextResponse.json({ 
        error: 'Payment ID and positive refund amount are required' 
      }, { status: 400 })
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      logger.logSystem('refund-error', 'Payment not found', { 
        paymentId,
        error: paymentError?.message 
      })
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Validate payment status
    if (payment.status !== 'completed') {
      return NextResponse.json({ 
        error: 'Can only refund completed payments' 
      }, { status: 400 })
    }

    // Check if payment has Stripe payment intent
    if (!payment.stripe_payment_intent_id) {
      return NextResponse.json({ 
        error: 'Cannot refund payment without Stripe payment intent' 
      }, { status: 400 })
    }

    // Calculate existing refunds for this payment
    const { data: existingRefunds, error: refundsError } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', paymentId)
      .in('status', ['completed', 'processing', 'pending'])

    if (refundsError) {
      logger.logSystem('refund-error', 'Failed to check existing refunds', { 
        paymentId,
        error: refundsError.message 
      })
      return NextResponse.json({ error: 'Failed to validate refund' }, { status: 500 })
    }

    const totalExistingRefunds = existingRefunds?.reduce((sum, refund) => sum + refund.amount, 0) || 0
    const availableForRefund = payment.final_amount - totalExistingRefunds

    // Validate refund amount
    if (amount > availableForRefund) {
      return NextResponse.json({ 
        error: `Cannot refund $${(amount / 100).toFixed(2)}. Only $${(availableForRefund / 100).toFixed(2)} available for refund.` 
      }, { status: 400 })
    }

    // Create refund record in database first
    const { data: refundRecord, error: insertError } = await supabase
      .from('refunds')
      .insert({
        payment_id: paymentId,
        user_id: payment.user_id,
        amount: amount,
        reason: reason || null,
        status: 'pending',
        processed_by: authUser.id,
      })
      .select()
      .single()

    if (insertError) {
      logger.logSystem('refund-error', 'Failed to create refund record', { 
        paymentId,
        amount,
        error: insertError.message 
      })
      return NextResponse.json({ error: 'Failed to create refund' }, { status: 500 })
    }

    // Process Stripe refund
    try {
      // Update refund status to processing
      await supabase
        .from('refunds')
        .update({ status: 'processing' })
        .eq('id', refundRecord.id)

      const stripeRefund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        amount: amount,
        reason: 'requested_by_customer',
        metadata: {
          refund_id: refundRecord.id,
          processed_by: authUser.id,
          reason: reason || 'Admin processed refund'
        }
      })

      // Update refund record with Stripe refund ID
      const { error: updateError } = await supabase
        .from('refunds')
        .update({
          stripe_refund_id: stripeRefund.id,
          status: 'completed', // Stripe refunds are usually instant
          completed_at: new Date().toISOString(),
        })
        .eq('id', refundRecord.id)

      if (updateError) {
        logger.logSystem('refund-warning', 'Stripe refund succeeded but failed to update database', { 
          refundId: refundRecord.id,
          stripeRefundId: stripeRefund.id,
          error: updateError.message 
        })
      }

      // Update payment status if fully refunded
      if (amount === availableForRefund && totalExistingRefunds === 0) {
        await supabase
          .from('payments')
          .update({
            status: 'refunded',
            refund_reason: reason || 'Admin processed refund',
            refunded_by: authUser.id,
          })
          .eq('id', paymentId)
      }

      // Process Xero credit note (async, don't wait for completion)
      processRefundWithXero(refundRecord.id).catch(xeroError => {
        logger.logSystem('refund-xero-error', 'Failed to create Xero credit note', {
          refundId: refundRecord.id,
          error: xeroError instanceof Error ? xeroError.message : 'Unknown error'
        })
      })

      // Log successful refund
      logger.logSystem('refund-processed', 'Refund processed successfully', {
        refundId: refundRecord.id,
        paymentId,
        amount,
        stripeRefundId: stripeRefund.id,
        processedBy: authUser.id,
        reason
      })

      return NextResponse.json({
        success: true,
        refund: {
          id: refundRecord.id,
          amount,
          stripeRefundId: stripeRefund.id,
          status: 'completed'
        },
        message: `Refund of $${(amount / 100).toFixed(2)} processed successfully`
      })

    } catch (stripeError) {
      // Update refund record to failed status
      await supabase
        .from('refunds')
        .update({
          status: 'failed',
          failure_reason: stripeError instanceof Error ? stripeError.message : 'Unknown Stripe error',
        })
        .eq('id', refundRecord.id)

      logger.logSystem('refund-error', 'Stripe refund failed', { 
        refundId: refundRecord.id,
        paymentId,
        amount,
        error: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      })

      return NextResponse.json({ 
        error: 'Refund processing failed. Please try again later.' 
      }, { status: 500 })
    }

  } catch (error) {
    logger.logSystem('refund-error', 'Unexpected error processing refund', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}