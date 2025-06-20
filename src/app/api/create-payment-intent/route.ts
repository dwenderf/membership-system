import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

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
    const { membershipId, durationMonths, amount } = body
    
    // Set payment context for Sentry
    const paymentContext = {
      userId: user.id,
      userEmail: user.email,
      membershipId: membershipId,
      amountCents: amount,
      endpoint: '/api/create-payment-intent',
      operation: 'payment_intent_creation'
    }
    setPaymentContext(paymentContext)

    // Validate required fields
    if (!membershipId || !durationMonths || !amount) {
      const error = new Error('Missing required fields: membershipId, durationMonths, amount')
      capturePaymentError(error, paymentContext, 'warning')
      
      return NextResponse.json(
        { error: 'Missing required fields: membershipId, durationMonths, amount' },
        { status: 400 }
      )
    }

    // Fetch membership details for metadata
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('*')
      .eq('id', membershipId)
      .single()

    if (membershipError || !membership) {
      capturePaymentError(membershipError || new Error('Membership not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    // Fetch user details for customer info
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      capturePaymentError(profileError || new Error('User profile not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Create payment intent with explicit Link support
    const paymentIntentParams = {
      amount: amount, // Amount in cents
      currency: 'usd',
      receipt_email: userProfile.email,
      payment_method_types: ['card', 'link'],
      metadata: {
        userId: user.id,
        membershipId: membershipId,
        membershipName: membership.name,
        durationMonths: durationMonths.toString(),
        userName: `${userProfile.first_name} ${userProfile.last_name}`,
      },
      description: `${membership.name} - ${durationMonths} months`,
    }
    
    const paymentIntent = await stripe.paymentIntents.create({
      ...paymentIntentParams,
      shipping: {
        name: `${userProfile.first_name} ${userProfile.last_name}`,
        address: {
          line1: '', // You can add address fields if you collect them
          country: 'US', // Default country
        },
      },
    })

    // Update payment context with payment intent ID
    paymentContext.paymentIntentId = paymentIntent.id

    // Create payment record in database
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: amount,
        final_amount: amount,
        stripe_payment_intent_id: paymentIntent.id,
        status: 'pending',
        payment_method: 'stripe',
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Error creating payment record:', paymentError)
      // Log warning but don't fail the request since Stripe intent was created
      capturePaymentError(paymentError, paymentContext, 'warning')
    } else if (paymentRecord) {
      // Create payment item record for the membership
      const { error: paymentItemError } = await supabase
        .from('payment_items')
        .insert({
          payment_id: paymentRecord.id,
          item_type: 'membership',
          item_id: membershipId,
          amount: amount,
        })

      if (paymentItemError) {
        console.error('Error creating payment item record:', paymentItemError)
        capturePaymentError(paymentItemError, paymentContext, 'warning')
      }
    }

    // Log successful operation
    capturePaymentSuccess('payment_intent_creation', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    })
    
  } catch (error) {
    console.error('Error creating payment intent:', error)
    
    // Capture error in Sentry
    capturePaymentError(error, {
      endpoint: '/api/create-payment-intent',
      operation: 'payment_intent_creation'
    }, 'error')
    
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    )
  }
}