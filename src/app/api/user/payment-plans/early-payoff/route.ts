import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'

export async function POST(request: Request) {
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

    const body = await request.json()
    const { planId } = body

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan ID is required' },
        { status: 400 }
      )
    }

    // Verify the payment plan belongs to the user
    const { data: paymentPlan, error: planError } = await supabase
      .from('payment_plans')
      .select('*')
      .eq('id', planId)
      .eq('user_id', authUser.id)
      .eq('status', 'active')
      .single()

    if (planError || !paymentPlan) {
      return NextResponse.json(
        { error: 'Payment plan not found or does not belong to you' },
        { status: 404 }
      )
    }

    // Process early payoff
    const result = await PaymentPlanService.processEarlyPayoff(planId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to process early payoff' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Payment plan paid in full successfully'
    })
  } catch (error) {
    console.error('Unexpected error processing early payoff:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
