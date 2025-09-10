import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { setupIntentId } = body || {}

    if (!setupIntentId) {
      return NextResponse.json({ error: 'setupIntentId is required' }, { status: 400 })
    }

    // Retrieve the setup intent from Stripe to validate
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)

    if (setupIntent.status !== 'succeeded') {
      return NextResponse.json({ error: `Setup intent not succeeded (status: ${setupIntent.status})` }, { status: 400 })
    }

    if (!setupIntent.payment_method) {
      return NextResponse.json({ error: 'Missing payment method on setup intent' }, { status: 400 })
    }

    // Verify this setup intent belongs to the same authenticated user via metadata
    const setupUserId = (setupIntent.metadata && (setupIntent.metadata.supabase_user_id || setupIntent.metadata.userId)) || null
    if (!setupUserId || setupUserId !== user.id) {
      return NextResponse.json({ error: 'Setup intent does not belong to current user' }, { status: 403 })
    }

    // Persist on user profile (idempotent if webhook already ran)
    const { error: updateError } = await adminSupabase
      .from('users')
      .update({
        stripe_payment_method_id: setupIntent.payment_method as string,
        stripe_setup_intent_id: setupIntent.id,
        setup_intent_status: 'succeeded',
        payment_method_updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Failed to update user on confirm-setup-intent:', updateError)
      return NextResponse.json({ error: 'Failed to persist setup intent' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in confirm-setup-intent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
