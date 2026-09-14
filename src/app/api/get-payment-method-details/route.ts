import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'
import { logger } from '@/lib/logging/logger'

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
      await getStripe().paymentMethods.retrieve(paymentMethodId)
    } catch (error) {
      logger.logPaymentProcessing('saved-payment-method-invalid', 'Saved payment method no longer valid', { userId: user.id, paymentMethodId, error: error instanceof Error ? error.message : String(error) }, 'warn')
      return NextResponse.json({ error: 'Saved payment method is no longer valid' }, { status: 400 })
    }

    return NextResponse.json({
      paymentMethodId: paymentMethodId,
      clientSecret: clientSecret
    })

  } catch (error) {
    logger.logPaymentProcessing('get-payment-method-details-error', 'Error getting payment method details', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}