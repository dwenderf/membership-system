import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server-client'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'
import { logger } from '@/lib/logging/logger'

export async function GET() {
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
    const paymentMethod = await getStripe().paymentMethods.retrieve(paymentMethodId)

    // A detached PaymentMethod is still retrievable (customer: null). Treat it, or one
    // attached to a different customer, as no saved card.
    const pmCustomerId = typeof paymentMethod.customer === 'string'
      ? paymentMethod.customer
      : paymentMethod.customer?.id ?? null
    const { data: profile } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()
    const expectedCustomerId = profile?.stripe_customer_id ?? null
    if (!pmCustomerId || (expectedCustomerId && pmCustomerId !== expectedCustomerId)) {
      return NextResponse.json({ paymentMethod: null })
    }

    return NextResponse.json({
      paymentMethod: {
        id: paymentMethod.id,
        card: paymentMethod.card,
      }
    })

  } catch (error) {
    logger.logPaymentProcessing('user-payment-method-fetch-error', 'Error fetching payment method', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}