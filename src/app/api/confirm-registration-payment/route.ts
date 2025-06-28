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
    const registrationId = paymentIntent.metadata.registrationId
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

    // Debug the data we're trying to insert
    const registrationData = {
      user_id: user.id,
      registration_id: registrationId,
      registration_category_id: categoryId,
      user_membership_id: activeMembership?.id || null,
      payment_status: 'paid',
      registration_fee: paymentIntent.amount, // Use registration_fee field
      amount_paid: paymentIntent.amount,
      registered_at: new Date().toISOString(),
    }
    
    console.log('DEBUG API: Creating registration with data:', registrationData)

    // Create user registration record - THIS IS THE CRITICAL OPERATION
    const { data: userRegistration, error: registrationError } = await supabase
      .from('user_registrations')
      .insert(registrationData)
      .select()
      .single()

    if (registrationError) {
      console.error('Error creating user registration:', registrationError)
      console.error('Registration data that failed:', registrationData)
      
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