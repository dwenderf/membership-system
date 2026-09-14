import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server-client'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { savePaymentMethodFromIntent } from '@/lib/services/payment-method-service'
import { logger } from '@/lib/logging/logger'

// Force import server config

import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, captureCriticalPaymentError, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'
import { Database } from '@/types/database'

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paymentIntentId, startDate, endDate } = body
    
    // Set payment context for Sentry
    const paymentContext = {
      userId: user.id,
      userEmail: user.email,
      paymentIntentId: paymentIntentId,
      endpoint: '/api/confirm-payment',
      operation: 'payment_confirmation',
      amountCents: 0, // Will be updated after payment intent retrieval
      membershipId: '' // Will be updated after payment intent retrieval
    }
    setPaymentContext(paymentContext)
    
    // Validate required fields
    if (!paymentIntentId || !startDate || !endDate) {
      const error = new Error('Missing required fields: paymentIntentId, startDate, endDate')
      capturePaymentError(error, paymentContext, 'warning')
      
      return NextResponse.json(
        { error: 'Missing required fields: paymentIntentId, startDate, endDate' },
        { status: 400 }
      )
    }

    // Retrieve the payment intent from Stripe
    const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId)

    // Update context with payment details
    paymentContext.amountCents = paymentIntent.amount
    paymentContext.membershipId = paymentIntent.metadata.membershipId
    
    if (paymentIntent.status !== 'succeeded') {
      // Capture payment failure as business event
      Sentry.captureMessage(`Payment confirmation failed - status: ${paymentIntent.status}`, {
        level: 'warning',
        tags: {
          payment_related: 'true',
          payment_status: paymentIntent.status,
          payment_intent_id: paymentIntentId
        },
        extra: {
          customer_email: user.email,
          customer_id: user.id,
          membership_id: paymentIntent.metadata.membershipId,
          membership_name: paymentIntent.metadata.membershipName,
          duration_months: paymentIntent.metadata.durationMonths,
          amount_cents: paymentIntent.amount,
          payment_intent_id: paymentIntentId,
          payment_status: paymentIntent.status
        }
      })
      
      return NextResponse.json(
        { error: 'Payment not completed' },
        { status: 400 }
      )
    }

    // Verify the payment intent belongs to this user
    if (paymentIntent.metadata.userId !== user.id) {
      const error = new Error('Payment intent does not belong to authenticated user')
      capturePaymentError(error, paymentContext, 'error')
      
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Extract metadata
    const membershipId = paymentIntent.metadata.membershipId
    const durationMonths = parseInt(paymentIntent.metadata.durationMonths)

    // Create user membership record - THIS IS THE CRITICAL OPERATION (handle duplicate gracefully)
    let userMembership: Database['public']['Tables']['user_memberships']['Row']
    try {
      const { data: newMembership, error: membershipError } = await supabase
        .from('user_memberships')
        .insert({
          user_id: user.id,
          membership_id: membershipId,
          valid_from: startDate,
          valid_until: endDate,
          months_purchased: durationMonths,
          payment_status: 'paid',
          stripe_payment_intent_id: paymentIntentId,
          amount_paid: paymentIntent.amount,
          purchased_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (membershipError) {
        if (membershipError.code === '23505') { // Duplicate key error
          logger.logPaymentProcessing('membership-duplicate-key', 'Membership already exists for payment intent, fetching existing record', { paymentIntentId }, 'debug')
          const { data: existingMembership, error: fetchError } = await supabase
            .from('user_memberships')
            .select('*')
            .eq('stripe_payment_intent_id', paymentIntentId)
            .single()

          if (fetchError || !existingMembership) {
            logger.logPaymentProcessing('membership-fetch-error', 'Error fetching existing membership', { paymentIntentId, error: fetchError?.message }, 'warn')
            throw new Error('Failed to fetch existing membership')
          }

          userMembership = existingMembership
        } else {
          logger.logPaymentProcessing('membership-create-error', 'Error creating user membership', { paymentIntentId, error: membershipError.message }, 'warn')
          throw new Error('Failed to create membership')
        }
      } else {
        userMembership = newMembership
      }
    } catch (error) {
      // Payment succeeded but membership creation failed - reported to Sentry below
      // with full context via captureCriticalPaymentError; logged here at warn to
      // avoid a duplicate Sentry error report for the same failure.
      logger.logPaymentProcessing('membership-creation-failed', 'Error in membership creation/fetch after successful payment', { paymentIntentId, membershipId, error: error instanceof Error ? error.message : String(error) }, 'warn')

      // THIS IS THE CRITICAL ERROR - Payment succeeded but membership creation failed
      captureCriticalPaymentError(error, paymentContext, [
        {
          operation: 'stripe_payment_intent_retrieve',
          success: true,
          details: { status: paymentIntent.status, amount: paymentIntent.amount }
        },
        {
          operation: 'user_membership_creation',
          success: false,
          error: error,
          details: { membershipId, durationMonths, startDate, endDate }
        }
      ])
      
      return NextResponse.json(
        { error: 'Failed to create membership record' },
        { status: 500 }
      )
    }

    // Save payment method if requested
    await savePaymentMethodFromIntent(paymentIntent, user.id, supabase)

    // Update payment record status
    const { data: updatedPayment, error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('stripe_payment_intent_id', paymentIntentId)
      .select()

    if (updateError) {
      // Non-fatal: membership was created successfully; reported to Sentry via
      // capturePaymentError below, so logged here at warn (not error) to avoid a
      // duplicate Sentry report.
      logger.logPaymentProcessing('payment-record-update-failed', 'Error updating payment record', { paymentIntentId, membershipId: userMembership.id, error: updateError.message }, 'warn')
      capturePaymentError(updateError, paymentContext, 'warning')
    } else if (updatedPayment && updatedPayment.length > 0) {
      logger.logPaymentProcessing('payment-record-updated', `Updated payment record to completed status: ${updatedPayment[0].id}`, { paymentIntentId, paymentId: updatedPayment[0].id }, 'info')

      // Update user_memberships record with payment_id
      const { error: membershipUpdateError } = await adminSupabase
        .from('user_memberships')
        .update({ payment_id: updatedPayment[0].id })
        .eq('id', userMembership.id)

      if (membershipUpdateError) {
        logger.logPaymentProcessing('membership-payment-id-link-failed', 'Error updating membership record with payment_id', { paymentIntentId, paymentId: updatedPayment[0].id, membershipId: userMembership.id, error: membershipUpdateError.message }, 'warn')
        capturePaymentError(membershipUpdateError, paymentContext, 'warning')
      } else {
        logger.logPaymentProcessing('membership-payment-id-linked', `Updated membership record with payment_id: ${updatedPayment[0].id}`, { paymentIntentId, paymentId: updatedPayment[0].id, membershipId: userMembership.id }, 'info')
      }
    } else {
      logger.logPaymentProcessing('payment-record-not-found', `No payment record found for payment intent: ${paymentIntentId}`, { paymentIntentId }, 'warn')
    }

    // Email confirmation is now handled by the payment completion processor
    // which is triggered by the webhook or the processor itself

    // Log successful operation
    capturePaymentSuccess('payment_confirmation', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      success: true,
      membershipId: userMembership.id,
      validFrom: userMembership.valid_from,
      validUntil: userMembership.valid_until,
    })
    
  } catch (error) {
    // Reported to Sentry below via capturePaymentError; logged here at warn to
    // avoid a duplicate Sentry error report for the same failure.
    logger.logPaymentProcessing('payment-confirmation-error', 'Error confirming payment', { error: error instanceof Error ? error.message : String(error) }, 'warn')

    // Capture error in Sentry
    capturePaymentError(error, {
      endpoint: '/api/confirm-payment',
      operation: 'payment_confirmation'
    }, 'error')
    
    return NextResponse.json(
      { error: 'Failed to confirm payment' },
      { status: 500 }
    )
  }
}