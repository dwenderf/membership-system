import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
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

    if (!stagingId || !paymentId || refundAmount === null || refundAmount === undefined) {
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

    // Check if this is a zero-dollar refund (free registration cancellation)
    const isZeroDollarRefund = refundAmount === 0

    // Validate payment has Stripe payment intent (unless zero-dollar refund)
    if (!isZeroDollarRefund && !payment.stripe_payment_intent_id) {
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
        status: isZeroDollarRefund ? 'completed' : 'pending', // Zero-dollar refunds complete immediately
        processed_by: authUser.id,
        ...(isZeroDollarRefund && { completed_at: new Date().toISOString() })
      })
      .select()
      .single()

    if (refundError || !refund) {
      return NextResponse.json({
        error: 'Failed to create refund record'
      }, { status: 500 })
    }

    // Payment validation was already done above - payment.stripe_payment_intent_id exists (unless zero-dollar)

    try {
      // For zero-dollar refunds (free registration cancellations), skip Stripe and just update status
      if (isZeroDollarRefund) {
        // Find all user_registrations associated with this payment
        const { data: registrations } = await supabase
          .from('user_registrations')
          .select('id, user_id, registration_id')
          .eq('payment_id', paymentId)
          .eq('payment_status', 'paid')

        if (registrations && registrations.length > 0) {
          // Update all registrations to refunded status
          await supabase
            .from('user_registrations')
            .update({
              payment_status: 'refunded',
              updated_at: new Date().toISOString()
            })
            .eq('payment_id', paymentId)
            .eq('payment_status', 'paid')

          logger.logSystem('zero-dollar-refund-complete',
            'Free registration cancelled successfully', {
            refundId: refund.id,
            paymentId,
            registrationCount: registrations.length
          })
        }

        return NextResponse.json({
          success: true,
          refund: {
            id: refund.id,
            amount: 0,
            status: 'completed'
          },
          message: 'Free registration cancelled successfully'
        })
      }

      // Regular (non-zero) refund processing with Stripe
      // Update staging records with the newly created refund ID
      // First get the existing staging metadata to preserve it
      const { data: existingStaging } = await supabase
        .from('xero_invoices')
        .select('staging_metadata')
        .eq('id', stagingId)
        .single()

      await supabase
        .from('xero_invoices')
        .update({
          'staging_metadata': {
            ...(existingStaging?.staging_metadata || {}), // Preserve existing metadata
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

      // Update user_registrations status for proportional refunds
      // Check if this is a proportional refund by looking at staging metadata
      const { data: stagingRecord } = await supabase
        .from('xero_invoices')
        .select('staging_metadata')
        .eq('id', stagingId)
        .single()

      // Check if it's a proportional refund (refund_type = 'refund' or 'proportional')
      const refundType = stagingRecord?.staging_metadata?.refund_type
      if (refundType === 'refund' || refundType === 'proportional') {
        // This is a proportional refund (not a discount code refund)
        // Find all user_registrations associated with this payment
        const { data: registrations } = await supabase
          .from('user_registrations')
          .select('id, user_id, registration_id')
          .eq('payment_id', paymentId)
          .eq('payment_status', 'paid')

        if (registrations && registrations.length > 0) {
          // Update all registrations to refunded status
          const { error: statusUpdateError } = await supabase
            .from('user_registrations')
            .update({
              payment_status: 'refunded',
              updated_at: new Date().toISOString()
            })
            .eq('payment_id', paymentId)
            .eq('payment_status', 'paid')

          if (statusUpdateError) {
            logger.logSystem('refund-status-update-error',
              'Failed to update registration status after refund', {
              refundId: refund.id,
              paymentId,
              registrationCount: registrations.length,
              error: statusUpdateError.message
            })
            // Don't fail the refund - just log the issue for admin attention
          } else {
            logger.logSystem('refund-status-updated',
              'Updated registration status to refunded', {
              refundId: refund.id,
              paymentId,
              registrationIds: registrations.map(r => r.id),
              count: registrations.length
            })
          }
        }
      }

      // Discount usage tracking will be handled by the webhook after successful refund

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