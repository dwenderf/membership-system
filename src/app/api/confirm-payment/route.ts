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
  
  // Test if this API is being called
  Sentry.captureMessage('Confirm payment API called', 'info')
  
  try {
    const supabase = await createClient()
    
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
      operation: 'payment_confirmation'
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
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    
    // Update context with payment details
    paymentContext.amountCents = paymentIntent.amount
    paymentContext.membershipId = paymentIntent.metadata.membershipId
    
    if (paymentIntent.status !== 'succeeded') {
      // Send info message to Sentry about payment failure
      Sentry.captureMessage(`Payment declined - status: ${paymentIntent.status}`, {
        level: 'info',
        tags: {
          payment_status: paymentIntent.status,
          payment_intent_id: paymentIntentId
        }
      })
      
      const error = new Error(`Payment not completed - status: ${paymentIntent.status}`)
      capturePaymentError(error, paymentContext, 'error')
      
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

    // Create user membership record - THIS IS THE CRITICAL OPERATION
    const { data: userMembership, error: membershipError } = await supabase
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
      console.error('Error creating user membership:', membershipError)
      
      // THIS IS THE CRITICAL ERROR - Payment succeeded but membership creation failed
      captureCriticalPaymentError(membershipError, paymentContext, [
        {
          operation: 'stripe_payment_intent_retrieve',
          success: true,
          details: { status: paymentIntent.status, amount: paymentIntent.amount }
        },
        {
          operation: 'user_membership_creation',
          success: false,
          error: membershipError,
          details: { membershipId, durationMonths, startDate, endDate }
        }
      ])
      
      return NextResponse.json(
        { error: 'Failed to create membership record' },
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
      // Log warning but don't fail - membership was created successfully
      capturePaymentError(updateError, paymentContext, 'warning')
    }

    // Get user and membership details for email
    const { data: userProfile } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .single()

    const { data: membershipDetails } = await supabase
      .from('memberships')
      .select('name')
      .eq('id', membershipId)
      .single()

    // Send confirmation email
    if (userProfile && membershipDetails) {
      try {
        await emailService.sendMembershipPurchaseConfirmation({
          userId: user.id,
          email: userProfile.email,
          userName: `${userProfile.first_name} ${userProfile.last_name}`,
          membershipName: membershipDetails.name,
          amount: paymentIntent.amount,
          durationMonths,
          validFrom: startDate,
          validUntil: endDate,
          paymentIntentId: paymentIntentId
        })
        console.log('✅ Membership confirmation email sent successfully')
      } catch (emailError) {
        console.error('❌ Failed to send confirmation email:', emailError)
        // Log warning but don't fail the request - membership was created successfully
        capturePaymentError(emailError, paymentContext, 'warning')
      }
    }

    // Log successful operation
    capturePaymentSuccess('payment_confirmation', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      success: true,
      membershipId: userMembership.id,
      validFrom: userMembership.valid_from,
      validUntil: userMembership.valid_until,
    })
    
  } catch (error) {
    console.error('Error confirming payment:', error)
    
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