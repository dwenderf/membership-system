import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { membershipId, durationMonths, amount } = body

    // Validate required fields
    if (!membershipId || !durationMonths || !amount) {
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
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    // Fetch user details for customer info
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // Amount in cents
      currency: 'usd',
      receipt_email: userProfile.email,
      metadata: {
        userId: user.id,
        membershipId: membershipId,
        membershipName: membership.name,
        durationMonths: durationMonths.toString(),
        userName: `${userProfile.first_name} ${userProfile.last_name}`,
      },
      description: `${membership.name} - ${durationMonths} months`,
    })

    // Create payment record in database
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: amount,
        final_amount: amount,
        stripe_payment_intent_id: paymentIntent.id,
        status: 'pending',
        payment_method: 'stripe',
      })

    if (paymentError) {
      console.error('Error creating payment record:', paymentError)
      // Don't fail the request, but log the error
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    })
    
  } catch (error) {
    console.error('Error creating payment intent:', error)
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    )
  }
}