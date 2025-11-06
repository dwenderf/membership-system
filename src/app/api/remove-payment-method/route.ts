import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { logger } from '@/lib/logging/logger'

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

    // Check for outstanding payment plan balances
    const hasOutstanding = await PaymentPlanService.hasOutstandingBalance(user.id)

    if (hasOutstanding) {
      const totalOutstanding = await PaymentPlanService.getTotalOutstandingBalance(user.id)

      logger.logPaymentProcessing(
        'payment-method-removal-blocked',
        'Payment method removal blocked due to outstanding payment plan balance',
        {
          userId: user.id,
          outstandingAmount: totalOutstanding
        },
        'info'
      )

      return NextResponse.json({
        error: 'Cannot remove payment method with outstanding payment plan balance',
        requiresPayoff: true,
        outstandingAmount: totalOutstanding
      }, { status: 400 })
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

    logger.logPaymentProcessing(
      'payment-method-removed',
      'Successfully removed payment method',
      { userId: user.id },
      'info'
    )

    // Rely on webhook 'payment_method.detached' to clear DB fields and remove alternates
    return NextResponse.json({ success: true })

  } catch (error) {
    logger.logPaymentProcessing(
      'payment-method-removal-error',
      'Error removing payment method',
      {
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    console.error('Error removing payment method:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}