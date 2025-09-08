import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})

export async function GET(request: NextRequest) {
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
      .select('stripe_payment_method_id, setup_intent_status')
      .eq('id', user.id)
      .single()

    if (!userProfile?.stripe_payment_method_id || userProfile.setup_intent_status !== 'succeeded') {
      return NextResponse.json({ paymentMethod: null })
    }

    // Get payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(userProfile.stripe_payment_method_id)

    return NextResponse.json({
      paymentMethod: {
        id: paymentMethod.id,
        card: paymentMethod.card,
      }
    })

  } catch (error) {
    console.error('Error fetching payment method:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}