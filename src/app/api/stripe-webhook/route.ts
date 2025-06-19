import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
})

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  const supabase = createClient()

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Extract metadata
        const userId = paymentIntent.metadata.userId
        const membershipId = paymentIntent.metadata.membershipId
        const durationMonths = parseInt(paymentIntent.metadata.durationMonths)

        if (!userId || !membershipId || !durationMonths) {
          console.error('Missing metadata in payment intent:', paymentIntent.id)
          break
        }

        // Check if user membership already exists (avoid duplicates)
        const { data: existingMembership } = await supabase
          .from('user_memberships')
          .select('*')
          .eq('stripe_payment_intent_id', paymentIntent.id)
          .single()

        if (existingMembership) {
          console.log('User membership already exists for payment intent:', paymentIntent.id)
          break
        }

        // Calculate dates - need to determine if this extends an existing membership
        const { data: userMemberships } = await supabase
          .from('user_memberships')
          .select('*')
          .eq('user_id', userId)
          .eq('membership_id', membershipId)
          .gte('valid_until', new Date().toISOString().split('T')[0])
          .order('valid_until', { ascending: false })

        let startDate = new Date()
        if (userMemberships && userMemberships.length > 0) {
          // Extend from the latest expiration date
          startDate = new Date(userMemberships[0].valid_until)
        }

        const endDate = new Date(startDate)
        endDate.setMonth(endDate.getMonth() + durationMonths)

        // Create user membership record
        const { error: membershipError } = await supabase
          .from('user_memberships')
          .insert({
            user_id: userId,
            membership_id: membershipId,
            valid_from: startDate.toISOString().split('T')[0],
            valid_until: endDate.toISOString().split('T')[0],
            months_purchased: durationMonths,
            payment_status: 'paid',
            stripe_payment_intent_id: paymentIntent.id,
            amount_paid: paymentIntent.amount,
            purchased_at: new Date().toISOString(),
          })

        if (membershipError) {
          console.error('Error creating user membership:', membershipError)
          return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 })
        }

        // Update payment record
        await supabase
          .from('payments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)

        console.log('Successfully processed payment intent:', paymentIntent.id)
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Update payment record
        await supabase
          .from('payments')
          .update({
            status: 'failed',
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)

        console.log('Payment failed for payment intent:', paymentIntent.id)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}