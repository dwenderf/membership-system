import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Create Stripe customer for this setup intent
    const customer = await stripe.customers.create({
      email: user.email || '',
      metadata: {
        supabase_user_id: user.id,
      },
    })

    // Create Setup Intent
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session', // For future payments
      metadata: {
        supabase_user_id: user.id,
        purpose: 'alternate_registration',
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