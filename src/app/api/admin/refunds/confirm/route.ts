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
    const { refundId, stagingId, reason } = body

    if (!refundId || !stagingId) {
      return NextResponse.json({ 
        error: 'Refund ID and staging ID are required' 
      }, { status: 400 })
    }

    // Get refund and payment details
    const { data: refund, error: refundError } = await supabase
      .from('refunds')
      .select(`
        *,
        payment:payments!inner (
          stripe_payment_intent_id,
          final_amount,
          user_id
        )
      `)
      .eq('id', refundId)
      .eq('status', 'staged')
      .single()

    if (refundError || !refund) {
      return NextResponse.json({ 
        error: 'Staged refund not found or no longer available' 
      }, { status: 404 })
    }

    // Validate payment has Stripe payment intent
    if (!refund.payment.stripe_payment_intent_id) {
      return NextResponse.json({ 
        error: 'Cannot refund payment without Stripe payment intent' 
      }, { status: 400 })
    }

    try {
      // Update refund status to processing
      await supabase
        .from('refunds')
        .update({ 
          status: 'processing',
          reason: reason || refund.reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', refundId)

      // Submit to Stripe with staging ID in metadata for webhook matching
      const stripeRefund = await stripe.refunds.create({
        payment_intent: refund.payment.stripe_payment_intent_id,
        amount: refund.amount,
        reason: 'requested_by_customer',
        metadata: {
          refund_id: refundId,
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
        .eq('id', refundId)

      // Staging records will be moved from 'staged' to 'pending' by webhook
      // when it receives the charge.refunded event

      logger.logSystem('refund-confirmed', 'Staged refund confirmed and submitted to Stripe', {
        refundId,
        stagingId,
        stripeRefundId: stripeRefund.id,
        amount: refund.amount,
        processedBy: authUser.id
      })

      return NextResponse.json({
        success: true,
        refund: {
          id: refundId,
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
        .eq('id', refundId)

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

      logger.logSystem('refund-stripe-error', 'Stripe refund failed for staged refund', { 
        refundId,
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