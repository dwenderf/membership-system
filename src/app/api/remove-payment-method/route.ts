import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's payment method info
    const { data: userProfile } = await supabase
      .from('users')
      .select('stripe_payment_method_id')
      .eq('id', user.id)
      .single()

    if (!userProfile?.stripe_payment_method_id) {
      return NextResponse.json({ error: 'No payment method found' }, { status: 404 })
    }

    // Detach payment method from Stripe
    await stripe.paymentMethods.detach(userProfile.stripe_payment_method_id)

    // Remove all alternate registrations for this user
    const { error: deleteAlternatesError } = await supabase
      .from('user_alternate_registrations')
      .delete()
      .eq('user_id', user.id)

    if (deleteAlternatesError) {
      console.error('Error removing alternate registrations:', deleteAlternatesError)
      // Continue anyway - payment method removal is more important
    }

    // Update user profile to remove payment method info
    const { error: updateError } = await supabase
      .from('users')
      .update({
        stripe_payment_method_id: null,
        stripe_setup_intent_id: null,
        setup_intent_status: null,
        payment_method_updated_at: null
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Error updating user profile:', updateError)
      return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error removing payment method:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}