import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email-service'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, captureCriticalPaymentError, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
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
      operation: 'registration_payment_confirmation'
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
      console.log('Creating new registration record (fallback)')
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

    // Update payment record status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('stripe_payment_intent_id', paymentIntentId)

    if (updateError) {
      console.error('Error updating payment record:', updateError)
      // Log warning but don't fail - registration was created successfully
      capturePaymentError(updateError, paymentContext, 'warning')
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

    // Send confirmation email
    if (userProfile && registrationDetails) {
      try {
        // Get the category details from the registration_categories
        const selectedCategory = registrationDetails.registration_categories.find(
          (cat: any) => cat.id === categoryId
        )
        
        const categoryName = selectedCategory?.category?.name || selectedCategory?.custom_name || 'Unknown Category'
        
        const emailResult = await emailService.sendRegistrationConfirmation({
          userId: user.id,
          email: userProfile.email,
          userName: `${userProfile.first_name} ${userProfile.last_name}`,
          registrationName: registrationDetails.name,
          categoryName: categoryName,
          seasonName: registrationDetails.season?.name || 'Unknown Season',
          amount: paymentIntent.amount,
          paymentIntentId: paymentIntentId
        })

        if (emailResult.success) {
          console.log('✅ Registration confirmation email sent successfully')
        } else {
          console.error('❌ Failed to send registration confirmation email:', emailResult.error)
          capturePaymentError(new Error(`Email delivery failed: ${emailResult.error}`), paymentContext, 'warning')
        }
      } catch (emailError) {
        console.error('❌ Failed to send confirmation email:', emailError)
        capturePaymentError(emailError, paymentContext, 'warning')
      }
    }

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