import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

// POST /api/admin/refunds/confirm - Submit staged refund to Stripe
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
    const { stagingId, reason, paymentId, refundAmount } = body

    if (!stagingId || !paymentId || !refundAmount) {
      return NextResponse.json({ 
        error: 'Staging ID, payment ID, and refund amount are required' 
      }, { status: 400 })
    }

    // Get payment details for creating refund record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json({ 
        error: 'Payment not found' 
      }, { status: 404 })
    }

    // Validate payment has Stripe payment intent
    if (!payment.stripe_payment_intent_id) {
      return NextResponse.json({ 
        error: 'Cannot refund payment without Stripe payment intent' 
      }, { status: 400 })
    }

    // Create refund record now that user is confirming
    const { data: refund, error: refundError } = await supabase
      .from('refunds')
      .insert({
        payment_id: paymentId,
        user_id: payment.user_id,
        amount: refundAmount,
        reason: reason || 'Admin processed refund',
        status: 'pending', // Will be updated based on Stripe response
        processed_by: authUser.id,
      })
      .select()
      .single()

    if (refundError || !refund) {
      return NextResponse.json({ 
        error: 'Failed to create refund record' 
      }, { status: 500 })
    }

    // Validate payment has Stripe payment intent
    if (!refund.payment.stripe_payment_intent_id) {
      return NextResponse.json({ 
        error: 'Cannot refund payment without Stripe payment intent' 
      }, { status: 400 })
    }

    try {
      // Update staging records with the newly created refund ID
      await supabase
        .from('xero_invoices')
        .update({
          'staging_metadata': {
            ...{}, // We'll update this properly in a moment
            refund_id: refund.id
          }
        })
        .eq('id', stagingId)

      // Update refund status to processing
      await supabase
        .from('refunds')
        .update({ 
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', refund.id)

      // Submit to Stripe with staging ID in metadata for webhook matching
      const stripeRefund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        amount: refund.amount,
        reason: 'requested_by_customer',
        metadata: {
          refund_id: refund.id,
          staging_id: stagingId, // Key for webhook to find staging records
          processed_by: authUser.id,
          reason: reason || 'Admin processed refund'
        }
      })

      // Update refund record with Stripe refund ID
      await supabase
        .from('refunds')
        .update({
          stripe_refund_id: stripeRefund.id,
          status: 'completed', // Stripe refunds are usually instant
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', refund.id)

      // Staging records will be moved from 'staged' to 'pending' by webhook
      // when it receives the charge.refunded event

      logger.logSystem('refund-confirmed', 'Refund confirmed and submitted to Stripe', {
        refundId: refund.id,
        stagingId,
        stripeRefundId: stripeRefund.id,
        amount: refund.amount,
        processedBy: authUser.id
      })

      return NextResponse.json({
        success: true,
        refund: {
          id: refund.id,
          stripe_refund_id: stripeRefund.id,
          amount: refund.amount,
          status: 'completed'
        },
        message: `Refund of $${(refund.amount / 100).toFixed(2)} processed successfully`
      })

    } catch (stripeError) {
      // Update refund record to failed status
      await supabase
        .from('refunds')
        .update({
          status: 'failed',
          failure_reason: stripeError instanceof Error ? stripeError.message : 'Unknown Stripe error',
          updated_at: new Date().toISOString()
        })
        .eq('id', refund.id)

      // Mark staging records as failed
      await supabase
        .from('xero_invoices')
        .update({
          sync_status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', stagingId)

      await supabase
        .from('xero_payments')
        .update({
          sync_status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('xero_invoice_id', stagingId)

      logger.logSystem('refund-stripe-error', 'Stripe refund failed', { 
        refundId: refund.id,
        stagingId,
        error: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      })

      return NextResponse.json({ 
        error: 'Refund processing failed. Please try again later.' 
      }, { status: 500 })
    }

  } catch (error) {
    logger.logSystem('refund-confirm-error', 'Unexpected error confirming staged refund', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}