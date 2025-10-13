import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's saved payment method ID
    const paymentMethodId = await getUserSavedPaymentMethodId(user.id, supabase)

    if (!paymentMethodId) {
      return NextResponse.json({ paymentMethod: null })
    }

    // Get payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)

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