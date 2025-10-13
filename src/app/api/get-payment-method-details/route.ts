import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
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
    const { clientSecret } = body

    if (!clientSecret) {
      return NextResponse.json({ error: 'Client secret is required' }, { status: 400 })
    }

    // Get user's saved payment method ID
    const paymentMethodId = await getUserSavedPaymentMethodId(user.id, supabase)

    if (!paymentMethodId) {
      return NextResponse.json({ error: 'No saved payment method found' }, { status: 404 })
    }

    // Verify the payment method still exists and is usable
    try {
      await stripe.paymentMethods.retrieve(paymentMethodId)
    } catch (error) {
      console.error('Saved payment method no longer valid:', error)
      return NextResponse.json({ error: 'Saved payment method is no longer valid' }, { status: 400 })
    }

    return NextResponse.json({
      paymentMethodId: paymentMethodId,
      clientSecret: clientSecret
    })

  } catch (error) {
    console.error('Error getting payment method details:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}