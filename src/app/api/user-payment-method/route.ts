import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server-client'
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
    const { data: profile } = await supabase
      .from('users')
      .select('stripe_payment_method_id, stripe_customer_id')
      .eq('id', user.id)
      .single()
    const paymentMethodId: string | null = profile?.stripe_payment_method_id ?? null

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
    // Fail closed: without a customer id on the user we can't verify ownership
    const expectedCustomerId: string | null = profile?.stripe_customer_id || null
    if (!pmCustomerId || !expectedCustomerId || pmCustomerId !== expectedCustomerId) {
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