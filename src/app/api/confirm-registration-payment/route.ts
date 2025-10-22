import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { savePaymentMethodFromIntent } from '@/lib/services/payment-method-service'

// Force import server config

import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, captureCriticalPaymentError, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

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
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    
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
            console.error('Error cleaning up failed payment reservation:', cleanupError)
          } else {
            console.log(`Cleaned up failed payment reservation: ${reservationId}`)
          }
        } catch (cleanupError) {
          console.error('Error during reservation cleanup:', cleanupError)
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
    const userMembershipId = null // For now, we won't require linking to specific membership

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
      console.log(`Attempting to update reservation ${reservationId} to paid status`)
      
      // First check what exists in the database
      const { data: existingRecord } = await supabase
        .from('user_registrations')
        .select('id, payment_status, user_id, registration_id')
        .eq('id', reservationId)
        .single()
      
      console.log(`Existing record for reservation ${reservationId}:`, existingRecord)
      
      // Check if webhook has already processed this payment
      if (existingRecord?.payment_status === 'paid') {
        console.log('✅ Payment already processed by webhook, using existing record')
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

            console.log(`Status update response:`, statusResponse.status)
            
            if (statusResponse.ok) {
              const statusData = await statusResponse.json()
              userRegistration = statusData.registration
              registrationError = null
              console.log(`✅ Updated registration to paid via API`)
            } else {
              const statusError = await statusResponse.json()
              registrationError = new Error(statusError.error || 'Failed to update status')
              console.log(`❌ Failed to update status:`, statusError)
            }
          } catch (apiError) {
            registrationError = apiError as Error
            console.log(`❌ API call error:`, apiError)
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
          console.log(`Reservation ${reservationId} not found, will create new registration record`)
          // Fall through to creation logic below
        }
      }
    }

    // Create new registration if reservation update failed or no reservation ID
    if (!userRegistration && (registrationError || !reservationId)) {
      console.log('🔍 Creating user_registrations record (CONFIRM-REGISTRATION-PAYMENT fallback path)', {
        userId: user.id,
        registrationId,
        categoryId,
        reservationId,
        hadError: !!registrationError,
        paymentStatus: 'paid',
        endpoint: 'confirm-registration-payment'
      })
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
      console.error('Error confirming registration:', registrationError)
      console.error('Payment intent metadata:', paymentIntent.metadata)
      
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
      console.error('Error updating payment record:', updateError)
      // Log warning but don't fail - registration was created successfully
      capturePaymentError(updateError, paymentContext, 'warning')
    } else if (updatedPayment && updatedPayment.length > 0) {
      console.log(`✅ Updated payment record to completed status: ${updatedPayment[0].id}`)

      // Update user_registrations record with payment_id
      const { error: registrationUpdateError } = await supabase
        .from('user_registrations')
        .update({ payment_id: updatedPayment[0].id })
        .eq('id', userRegistration.id)

      if (registrationUpdateError) {
        console.error('Error updating registration record with payment_id:', registrationUpdateError)
        capturePaymentError(registrationUpdateError, paymentContext, 'warning')
      } else {
        console.log(`✅ Updated registration record with payment_id: ${updatedPayment[0].id}`)
      }
    } else {
      console.warn(`⚠️ No payment record found for payment intent: ${paymentIntentId}`)
    }



    // Get user and registration details for email
    const { data: userProfile } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .single()

    const { data: registrationDetails } = await supabase
      .from('registrations')
      .select(`
        *,
        season:seasons(*),
        registration_categories(
          *,
          category:categories(name)
        )
      `)
      .eq('id', registrationId)
      .single()

    // Record discount usage if applicable (same logic as webhook)
    const discountCode = paymentIntent.metadata.discountCode
    const discountAmount = parseInt(paymentIntent.metadata.discountAmount || '0')
    const discountCategoryId = paymentIntent.metadata.discountCategoryId

    if (discountCode && discountAmount > 0 && discountCategoryId) {
      try {
        // Get the discount code record
        const { data: discountCodeRecord } = await supabase
          .from('discount_codes')
          .select(`
            id,
            category:discount_categories(id, name)
          `)
          .eq('code', discountCode)
          .eq('is_active', true)
          .single()

        if (discountCodeRecord) {
          // Check if discount usage already exists to prevent duplicates
          const { data: existingUsage } = await supabase
            .from('discount_usage')
            .select('id')
            .eq('user_id', user.id)
            .eq('discount_code_id', discountCodeRecord.id)
            .eq('registration_id', registrationId)
            .single()

          if (!existingUsage) {
            // Record discount usage only if it doesn't already exist
            const { error: usageError } = await supabase
              .from('discount_usage')
              .insert({
                user_id: user.id,
                discount_code_id: discountCodeRecord.id,
                discount_category_id: discountCategoryId,
                season_id: registrationDetails?.season?.id,
                amount_saved: discountAmount,
                registration_id: registrationId,
              })

            if (usageError) {
              console.error('Error recording discount usage:', usageError)
              // Don't fail the payment - just log the error
              capturePaymentError(usageError, paymentContext, 'warning')
            } else {
              console.log('✅ Recorded discount usage for payment intent:', paymentIntentId)
            }
          } else {
            console.log('ℹ️ Discount usage already recorded for payment intent:', paymentIntentId)
          }
        }
      } catch (discountError) {
        console.error('Error processing discount usage:', discountError)
        // Don't fail the payment - just log the error
        capturePaymentError(discountError, paymentContext, 'warning')
      }
    }

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
    console.error('Error confirming registration payment:', error)
    
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