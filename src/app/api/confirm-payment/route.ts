import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email-service'

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
    const { paymentIntentId, startDate, endDate } = body

    // Validate required fields
    if (!paymentIntentId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Missing required fields: paymentIntentId, startDate, endDate' },
        { status: 400 }
      )
    }

    // Retrieve the payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    
    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { error: 'Payment not completed' },
        { status: 400 }
      )
    }

    // Verify the payment intent belongs to this user
    if (paymentIntent.metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Extract metadata
    const membershipId = paymentIntent.metadata.membershipId
    const durationMonths = parseInt(paymentIntent.metadata.durationMonths)

    // Create user membership record
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
      // Don't fail the request, membership was created successfully
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
        // Don't fail the request - membership was created successfully
      }
    }

    return NextResponse.json({
      success: true,
      membershipId: userMembership.id,
      validFrom: userMembership.valid_from,
      validUntil: userMembership.valid_until,
    })
    
  } catch (error) {
    console.error('Error confirming payment:', error)
    return NextResponse.json(
      { error: 'Failed to confirm payment' },
      { status: 500 }
    )
  }
}