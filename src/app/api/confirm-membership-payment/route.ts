import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
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
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

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
    let userMembership: any
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
          console.log('Membership already exists for payment intent, fetching existing record:', paymentIntentId)
          const { data: existingMembership, error: fetchError } = await supabase
            .from('user_memberships')
            .select('*')
            .eq('stripe_payment_intent_id', paymentIntentId)
            .single()
          
          if (fetchError || !existingMembership) {
            console.error('Error fetching existing membership:', fetchError)
            throw new Error('Failed to fetch existing membership')
          }
          
          userMembership = existingMembership
        } else {
          console.error('Error creating user membership:', membershipError)
          throw new Error('Failed to create membership')
        }
      } else {
        userMembership = newMembership
      }
    } catch (error) {
      console.error('Error in membership creation/fetch:', error)
      
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
      console.error('Error updating payment record:', updateError)
      // Log warning but don't fail - membership was created successfully
      capturePaymentError(updateError, paymentContext, 'warning')
    } else if (updatedPayment && updatedPayment.length > 0) {
      console.log(`✅ Updated payment record to completed status: ${updatedPayment[0].id}`)

      // Update user_memberships record with payment_id
      const { error: membershipUpdateError } = await adminSupabase
        .from('user_memberships')
        .update({ payment_id: updatedPayment[0].id })
        .eq('id', userMembership.id)

      if (membershipUpdateError) {
        console.error('Error updating membership record with payment_id:', membershipUpdateError)
        capturePaymentError(membershipUpdateError, paymentContext, 'warning')
      } else {
        console.log(`✅ Updated membership record with payment_id: ${updatedPayment[0].id}`)
      }
    } else {
      console.warn(`⚠️ No payment record found for payment intent: ${paymentIntentId}`)
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