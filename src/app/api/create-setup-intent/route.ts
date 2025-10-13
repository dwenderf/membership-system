import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { isUpdate } = body

    // Get or create Stripe customer
    const { data: userProfile } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    let customerId = userProfile?.stripe_customer_id

    // If updating and customer exists, use existing customer
    // Otherwise create new customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || '',
        metadata: {
          supabase_user_id: user.id,
        },
      })
      customerId = customer.id

      // Store the customer ID in the users table
      const { error: updateError } = await adminSupabase
        .from('users')
        .update({
          stripe_customer_id: customerId,
        })
        .eq('id', user.id)

      if (updateError) {
        console.error('Failed to store customer ID:', updateError)
      }
    }

    // Create Setup Intent (only 'card' payment method type - no Link)
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session', // For future payments
      metadata: {
        supabase_user_id: user.id,
        userId: user.id,
        purpose: isUpdate ? 'update_payment_method' : 'alternate_registration',
      },
    })

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
    })

  } catch (error) {
    console.error('Error creating setup intent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}