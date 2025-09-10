import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's payment method info
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('stripe_payment_method_id')
      .eq('id', user.id)
      .single()

    if (!userProfile?.stripe_payment_method_id) {
      return NextResponse.json({ error: 'No payment method found' }, { status: 404 })
    }

    // Detach payment method from Stripe
    await stripe.paymentMethods.detach(userProfile.stripe_payment_method_id)

    // Rely on webhook 'payment_method.detached' to clear DB fields and remove alternates
    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error removing payment method:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}