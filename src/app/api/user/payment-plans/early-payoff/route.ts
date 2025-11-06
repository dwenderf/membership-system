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
    // planId is now the xero_invoice_id
    const { data: invoice, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select('id, contact_id, is_payment_plan')
      .eq('id', planId)
      .eq('contact_id', authUser.id)
      .eq('is_payment_plan', true)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Payment plan not found or does not belong to you' },
        { status: 404 }
      )
    }

    // Check if there are any planned payments left
    const { data: plannedPayments } = await supabase
      .from('xero_payments')
      .select('id')
      .eq('xero_invoice_id', planId)
      .eq('sync_status', 'planned')
      .limit(1)

    if (!plannedPayments || plannedPayments.length === 0) {
      return NextResponse.json(
        { error: 'Payment plan is already completed' },
        { status: 400 }
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
