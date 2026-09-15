import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

export async function GET() {
  try {
    const supabase = await createClient()

    // Get current authenticated user
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get user's payment plan eligibility status and payment method
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('payment_plan_enabled, stripe_payment_method_id')
      .eq('id', authUser.id)
      .single()

    if (userError) {
      logger.logPaymentProcessing('payment-plan-eligibility-user-fetch-error', 'Error fetching user for payment plan eligibility check', { userId: authUser.id, error: userError.message }, 'error')
      return NextResponse.json(
        { error: 'Failed to fetch user data' },
        { status: 500 }
      )
    }

    // User is eligible if:
    // 1. payment_plan_enabled is true (admin-controlled eligibility)
    // 2. They have a saved payment method
    const hasSavedPaymentMethod = !!user.stripe_payment_method_id
    const eligible = (user.payment_plan_enabled === true) && hasSavedPaymentMethod

    return NextResponse.json({
      eligible,
      paymentPlanEnabled: user.payment_plan_enabled || false,
      hasSavedPaymentMethod
    })
  } catch (error) {
    logger.logPaymentProcessing('payment-plan-eligibility-unexpected-error', 'Unexpected error checking payment plan eligibility', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
