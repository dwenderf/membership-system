import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server-client'
import { createClient } from '@/lib/supabase/server'
import { savePaymentMethodFromIntent } from '@/lib/services/payment-method-service'
import { logger } from '@/lib/logging/logger'

// Force import server config

import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, captureCriticalPaymentError, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const supabase = await createClient()
    const { createAdminClient } = await import('@/lib/supabase/server')
    const adminSupabase = createAdminClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paymentIntentId, categoryId } = body

    // Set payment context for Sentry
    const paymentContext = {
      userId: user.id,
      userEmail: user.email,
      paymentIntentId: paymentIntentId,
      categoryId: categoryId,
      endpoint: '/api/confirm-registration-payment',
      operation: 'registration_payment_confirmation',
      amountCents: 0, // Will be updated after payment intent retrieval
      registrationId: '' // Will be updated after payment intent retrieval
    }
    setPaymentContext(paymentContext)

    // Validate required fields
    if (!paymentIntentId || !categoryId) {
      const error = new Error('Missing required fields: paymentIntentId, categoryId')
      capturePaymentError(error, paymentContext, 'warning')

      return NextResponse.json(
        { error: 'Missing required fields: paymentIntentId, categoryId' },
        { status: 400 }
      )
    }

    // Retrieve the payment intent from Stripe
    const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId)

    // Update context with payment details
    paymentContext.amountCents = paymentIntent.amount
    paymentContext.registrationId = paymentIntent.metadata.registrationId

    if (paymentIntent.status !== 'succeeded') {
      // Clean up processing reservation for failed/cancelled payments
      const reservationId = paymentIntent.metadata.reservationId
      if (reservationId) {
        try {
          const { error: cleanupError } = await supabase
            .from('user_registrations')
            .delete()
            .eq('id', reservationId)
            .eq('user_id', user.id)
            .eq('payment_status', 'awaiting_payment')

          if (cleanupError) {
            logger.logPaymentProcessing('reservation-cleanup-failed', 'Error cleaning up failed payment reservation', { reservationId, paymentIntentId, error: cleanupError.message }, 'warn')
          } else {
            logger.logPaymentProcessing('reservation-cleaned-up', `Cleaned up failed payment reservation: ${reservationId}`, { reservationId, paymentIntentId }, 'debug')
          }
        } catch (cleanupError) {
          logger.logPaymentProcessing('reservation-cleanup-error', 'Error during reservation cleanup', { reservationId, paymentIntentId, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }, 'warn')
        }
      }

      // Capture payment failure as business event
      Sentry.captureMessage(`Registration payment confirmation failed - status: ${paymentIntent.status}`, {
        level: 'warning',
        tags: {
          payment_related: 'true',
          payment_status: paymentIntent.status,
          payment_intent_id: paymentIntentId
        },
        extra: {
          customer_email: user.email,
          customer_id: user.id,
          registration_id: paymentIntent.metadata.registrationId,
          registration_name: paymentIntent.metadata.registrationName,
          category_id: paymentIntent.metadata.categoryId,
          category_name: paymentIntent.metadata.categoryName,
          amount_cents: paymentIntent.amount,
          payment_intent_id: paymentIntentId,
          payment_status: paymentIntent.status,
          reservation_cleaned_up: !!reservationId
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
    const registrationId = paymentIntent.metadata.registrationId
    const reservationId = paymentIntent.metadata.reservationId

    // Get user's active membership for eligibility (if any)
    const { data: activeMembership } = await supabase
      .from('user_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('payment_status', 'paid')
      .gte('valid_until', new Date().toISOString().split('T')[0])
      .limit(1)
      .single()

    // RESERVATION SYSTEM: Update existing processing record to paid
    let userRegistration
    let registrationError

    if (reservationId) {
      // First check what exists in the database
      const { data: existingRecord } = await supabase
        .from('user_registrations')
        .select('id, payment_status, user_id, registration_id')
        .eq('id', reservationId)
        .single()

      logger.logPaymentProcessing('reservation-existing-record-check', `Checked existing record for reservation ${reservationId}`, { reservationId, existingRecord }, 'debug')

      // Check if webhook has already processed this payment
      if (existingRecord?.payment_status === 'paid') {
        logger.logPaymentProcessing('reservation-already-processed-by-webhook', 'Payment already processed by webhook, using existing record', { reservationId }, 'debug')
        userRegistration = existingRecord
        registrationError = null
        // Skip the API call since webhook already handled it
              } else {
          // Update existing reservation to paid status via standardized API
          try {
            const { getBaseUrl } = await import('@/lib/url-utils')
            const statusResponse = await fetch(`${getBaseUrl()}/api/update-registration-status`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': request.headers.get('cookie') || '',
              },
              body: JSON.stringify({
                registrationId: registrationId,
                categoryId: categoryId,
                status: 'paid',
                userMembershipId: activeMembership?.id || null
              }),
            })

            if (statusResponse.ok) {
              const statusData = await statusResponse.json()
              userRegistration = statusData.registration
              registrationError = null
              logger.logPaymentProcessing('reservation-updated-via-api', 'Updated registration to paid via update-registration-status API', { reservationId, registrationId }, 'info')
            } else {
              const statusError = await statusResponse.json()
              registrationError = new Error(statusError.error || 'Failed to update status')
              logger.logPaymentProcessing('reservation-status-update-failed', 'Failed to update registration status via API', { reservationId, registrationId, statusCode: statusResponse.status, error: statusError }, 'warn')
            }
          } catch (apiError) {
            registrationError = apiError as Error
            logger.logPaymentProcessing('reservation-status-update-api-error', 'Error calling update-registration-status API', { reservationId, registrationId, error: apiError instanceof Error ? apiError.message : String(apiError) }, 'warn')
          }
        }

      // If reservation not found or expired, check if it was already processed
      if (registrationError) {
        const { data: existingPaid } = await supabase
          .from('user_registrations')
          .select()
          .eq('id', reservationId)
          .eq('user_id', user.id)
          .eq('payment_status', 'paid')
          .single()

        if (existingPaid) {
          // Payment already processed, return success
          userRegistration = existingPaid
          registrationError = null
        } else {
          // Reservation not found (likely cleaned up), fall back to creating new record
          logger.logPaymentProcessing('reservation-not-found-fallback', `Reservation ${reservationId} not found, falling back to creating new registration record`, { reservationId, registrationId }, 'info')
          // Fall through to creation logic below
        }
      }
    }

    // Create new registration if reservation update failed or no reservation ID
    if (!userRegistration && (registrationError || !reservationId)) {
      logger.logPaymentProcessing('registration-fallback-create-attempt', 'Creating user_registrations record (confirm-registration-payment fallback path)', {
        userId: user.id,
        registrationId,
        categoryId,
        reservationId,
        hadError: !!registrationError,
        paymentStatus: 'paid'
      }, 'debug')
      const registrationData = {
        user_id: user.id,
        registration_id: registrationId,
        registration_category_id: categoryId,
        user_membership_id: activeMembership?.id || null,
        payment_status: 'paid',
        registration_fee: paymentIntent.amount,
        amount_paid: paymentIntent.amount,
        presale_code_used: paymentIntent.metadata.presaleCodeUsed || null,
        registered_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntent.id,
      }

      const { data, error } = await adminSupabase
        .from('user_registrations')
        .insert(registrationData)
        .select()
        .single()

      userRegistration = data
      registrationError = error
    }

    if (registrationError) {
      // Payment succeeded but registration creation failed - reported to Sentry below
      // with full context via captureCriticalPaymentError; logged here at warn to
      // avoid a duplicate Sentry error report for the same failure.
      logger.logPaymentProcessing('registration-creation-failed', 'Error confirming registration after successful payment', {
        registrationId,
        categoryId,
        paymentIntentId,
        error: registrationError instanceof Error ? registrationError.message : String(registrationError),
        paymentIntentMetadata: paymentIntent.metadata
      }, 'warn')

      // THIS IS THE CRITICAL ERROR - Payment succeeded but registration creation failed
      captureCriticalPaymentError(registrationError, paymentContext, [
        {
          operation: 'stripe_payment_intent_retrieve',
          success: true,
          details: { status: paymentIntent.status, amount: paymentIntent.amount }
        },
        {
          operation: 'user_registration_creation',
          success: false,
          error: registrationError,
          details: { registrationId, categoryId }
        }
      ])

      return NextResponse.json(
        { error: 'Failed to create registration record' },
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
      // Non-fatal: registration was created successfully; reported to Sentry via
      // capturePaymentError below, so logged here at warn (not error) to avoid a
      // duplicate Sentry report.
      logger.logPaymentProcessing('payment-record-update-failed', 'Error updating payment record', { paymentIntentId, registrationId: userRegistration.id, error: updateError.message }, 'warn')
      capturePaymentError(updateError, paymentContext, 'warning')
    } else if (updatedPayment && updatedPayment.length > 0) {
      logger.logPaymentProcessing('payment-record-updated', `Updated payment record to completed status: ${updatedPayment[0].id}`, { paymentIntentId, paymentId: updatedPayment[0].id }, 'info')

      // Update user_registrations record with payment_id
      const { error: registrationUpdateError } = await supabase
        .from('user_registrations')
        .update({ payment_id: updatedPayment[0].id })
        .eq('id', userRegistration.id)

      if (registrationUpdateError) {
        logger.logPaymentProcessing('registration-payment-id-link-failed', 'Error updating registration record with payment_id', { paymentIntentId, paymentId: updatedPayment[0].id, registrationId: userRegistration.id, error: registrationUpdateError.message }, 'warn')
        capturePaymentError(registrationUpdateError, paymentContext, 'warning')
      } else {
        logger.logPaymentProcessing('registration-payment-id-linked', `Updated registration record with payment_id: ${updatedPayment[0].id}`, { paymentIntentId, paymentId: updatedPayment[0].id, registrationId: userRegistration.id }, 'info')
      }
    } else {
      logger.logPaymentProcessing('payment-record-not-found', `No payment record found for payment intent: ${paymentIntentId}`, { paymentIntentId }, 'warn')
    }

    // Note: Discount usage is now tracked via discount_usage_computed view
    // which derives data from xero_invoice_line_items

    // Email confirmation is now handled by the payment completion processor
    // which is triggered by the webhook or the processor itself

    // Log successful operation
    capturePaymentSuccess('registration_payment_confirmation', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      success: true,
      registrationId: userRegistration.id,
      registeredAt: userRegistration.registered_at,
    })

  } catch (error) {
    // Reported to Sentry below via capturePaymentError; logged here at warn to
    // avoid a duplicate Sentry error report for the same failure.
    logger.logPaymentProcessing('registration-payment-confirmation-error', 'Error confirming registration payment', { error: error instanceof Error ? error.message : String(error) }, 'warn')

    // Capture error in Sentry
    capturePaymentError(error, {
      endpoint: '/api/confirm-registration-payment',
      operation: 'registration_payment_confirmation'
    }, 'error')

    return NextResponse.json(
      { error: 'Failed to confirm payment' },
      { status: 500 }
    )
  }
}
