import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import { emailService } from '@/lib/email/service'
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
      console.error('[refunds/confirm] Failed to create refund record:', {
        error: refundError,
        refundAmount,
        paymentId,
        userId: payment.user_id,
        isZeroDollar: isZeroDollarRefund
      })
      return NextResponse.json({
        error: 'Failed to create refund record',
        details: refundError?.message || 'Unknown error'
      }, { status: 500 })
    }

    // Payment validation was already done above - payment.stripe_payment_intent_id exists (unless zero-dollar)

    try {
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

      // For zero-dollar refunds with line items (e.g., $50 registration - $50 discount)
      // Skip Stripe but still process the credit note for accounting
      if (isZeroDollarRefund) {
        console.log('[zero-dollar-refund] Processing zero-dollar refund:', {
          refundId: refund.id,
          paymentId,
          stagingId
        })

        // Mark staging as pending for Xero sync (skip webhook)
        await supabase
          .from('xero_invoices')
          .update({
            sync_status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', stagingId)

        // Zero-dollar refunds don't have payment records (similar to zero-dollar invoices)
        // So we skip the xero_payments update entirely

        // Update refund to completed
        await supabase
          .from('refunds')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', refund.id)

        // Update user_registrations to refunded
        // Use admin client to bypass RLS policies (admin updating user's registrations)
        const adminSupabase = createAdminClient()

        console.log('[zero-dollar-refund] Querying user_registrations for paymentId:', paymentId)
        const { data: registrations, error: queryError } = await adminSupabase
          .from('user_registrations')
          .select('id, payment_status, registration_id, user_id')
          .eq('payment_id', paymentId)

        console.log('[zero-dollar-refund] Found registrations:', {
          count: registrations?.length || 0,
          registrations,
          queryError
        })

        if (registrations && registrations.length > 0) {
          // Filter to only 'paid' registrations
          const paidRegistrations = registrations.filter(r => r.payment_status === 'paid')
          console.log('[zero-dollar-refund] Paid registrations to update:', {
            paidCount: paidRegistrations.length,
            paidIds: paidRegistrations.map(r => r.id)
          })

          if (paidRegistrations.length > 0) {
            const { data: updateResult, error: updateError } = await adminSupabase
              .from('user_registrations')
              .update({
                payment_status: 'refunded',
                refunded_at: new Date().toISOString()
              })
              .eq('payment_id', paymentId)
              .eq('payment_status', 'paid')
              .select()

            if (updateError) {
              console.error('[zero-dollar-refund] Failed to update user_registrations:', {
                error: updateError,
                paymentId,
                registrationIds: paidRegistrations.map(r => r.id)
              })
            } else {
              console.log('[zero-dollar-refund] Updated user_registrations:', {
                count: updateResult?.length,
                paymentId,
                updatedRecords: updateResult
              })
            }

            logger.logSystem('zero-dollar-refund-complete',
              'Zero-dollar refund processed successfully', {
              refundId: refund.id,
              paymentId,
              stagingId,
              registrationCount: paidRegistrations.length,
              updateSuccess: !updateError,
              updatedCount: updateResult?.length
            })
          } else {
            console.warn('[zero-dollar-refund] No paid registrations to update')
          }
        } else {
          console.warn('[zero-dollar-refund] No registrations found for payment:', paymentId)
        }

        // Send refund email notification
        try {
          const { data: user } = await supabase
            .from('users')
            .select('email, first_name, last_name')
            .eq('id', payment.user_id)
            .single()

          if (user && process.env.LOOPS_REFUND_TEMPLATE_ID) {
            await emailService.sendRefund({
              userId: payment.user_id,
              email: user.email,
              userName: `${user.first_name} ${user.last_name}`,
              refundAmount: 0,
              originalAmount: payment.final_amount,
              reason: reason || 'Registration cancelled',
              paymentDate: new Date(payment.created_at).toLocaleDateString(),
              refundDate: new Date().toLocaleDateString()
            })

            console.log('[zero-dollar-refund] Refund email sent to:', user.email)
          } else if (!process.env.LOOPS_REFUND_TEMPLATE_ID) {
            console.warn('[zero-dollar-refund] LOOPS_REFUND_TEMPLATE_ID not configured, skipping email')
          }
        } catch (emailError) {
          console.error('[zero-dollar-refund] Failed to send refund email:', emailError)
          // Don't fail the refund if email fails
        }

        return NextResponse.json({
          success: true,
          refund: {
            id: refund.id,
            amount: 0,
            status: 'completed'
          },
          message: 'Zero-dollar refund processed with credit note for accounting'
        })
      }

      // Update refund status to processing (for non-zero refunds only)
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
      // Use admin client to bypass RLS policies (admin updating user's registrations)
      const adminSupabase = createAdminClient()

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
        const { data: registrations } = await adminSupabase
          .from('user_registrations')
          .select('id, user_id, registration_id')
          .eq('payment_id', paymentId)
          .eq('payment_status', 'paid')

        if (registrations && registrations.length > 0) {
          // Update all registrations to refunded status
          const { error: statusUpdateError } = await adminSupabase
            .from('user_registrations')
            .update({
              payment_status: 'refunded',
              refunded_at: new Date().toISOString()
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

      // Send refund email notification
      try {
        const { data: user } = await supabase
          .from('users')
          .select('email, first_name, last_name')
          .eq('id', payment.user_id)
          .single()

        if (user && process.env.LOOPS_REFUND_TEMPLATE_ID) {
          await emailService.sendRefund({
            userId: payment.user_id,
            email: user.email,
            userName: `${user.first_name} ${user.last_name}`,
            refundAmount: refund.amount,
            originalAmount: payment.final_amount,
            reason: reason || 'Refund processed by administrator',
            paymentDate: new Date(payment.created_at).toLocaleDateString(),
            refundDate: new Date().toLocaleDateString()
          })

          console.log('[refund-confirmed] Refund email sent to:', user.email)
        } else if (!process.env.LOOPS_REFUND_TEMPLATE_ID) {
          console.warn('[refund-confirmed] LOOPS_REFUND_TEMPLATE_ID not configured, skipping email')
        }
      } catch (emailError) {
        console.error('[refund-confirmed] Failed to send refund email:', emailError)
        // Don't fail the refund if email fails
      }

      // Check if this is a partial or full refund
      const isPartialRefund = refund.amount < payment.final_amount
      const refundMessage = isPartialRefund
        ? `Partial refund of $${(refund.amount / 100).toFixed(2)} (of $${(payment.final_amount / 100).toFixed(2)}) processed successfully`
        : `Full refund of $${(refund.amount / 100).toFixed(2)} processed successfully`

      return NextResponse.json({
        success: true,
        refund: {
          id: refund.id,
          stripe_refund_id: stripeRefund.id,
          amount: refund.amount,
          status: 'completed'
        },
        message: refundMessage
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