/**
 * Shared request handling for the early-payoff endpoints (#452):
 * /api/user/payment-plans/early-payoff and the legacy /api/payment-plans/[id]/payoff.
 * Both get the same ownership check and the same server-side guards; the amount is never taken
 * from the client - PaymentPlanService.processEarlyPayoff computes it from the rows it claims.
 */
import { NextResponse } from 'next/server'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any }

export async function handleEarlyPayoffRequest(
  supabase: SupabaseLike,
  userId: string,
  planId: string
): Promise<NextResponse> {
  // planId is the xero_invoice_id. contact_id lives in staging_metadata->>'user_id'.
  const { data: invoice, error: invoiceError } = await supabase
    .from('xero_invoices')
    .select('id, is_payment_plan, staging_metadata')
    .eq('id', planId)
    .eq('is_payment_plan', true)
    .single()

  if (invoiceError || !invoice || invoice.staging_metadata?.user_id !== userId) {
    return NextResponse.json({ error: 'Payment plan not found or does not belong to you' }, { status: 404 })
  }

  // Fast path for the common "already paid" case; the authoritative guard is the atomic claim
  // inside processEarlyPayoff.
  const { data: plannedPayments } = await supabase
    .from('xero_payments')
    .select('id')
    .eq('xero_invoice_id', planId)
    .eq('sync_status', 'planned')
    .limit(1)

  if (!plannedPayments || plannedPayments.length === 0) {
    return NextResponse.json({ error: 'Payment plan is already completed' }, { status: 400 })
  }

  const result = await PaymentPlanService.processEarlyPayoff(planId, userId)

  if (!result.success) {
    const status =
      result.code === 'in_progress' ? 409 :
      result.code === 'processing' ? 202 :
      result.code === 'nothing_to_pay' ? 400 :
      result.code === 'charge_failed' ? 402 :
      400
    return NextResponse.json(
      { error: result.error || 'Failed to process early payoff', code: result.code },
      { status }
    )
  }

  return NextResponse.json({
    success: true,
    message: 'Payment plan paid in full successfully',
    paymentId: result.paymentId,
    amountPaid: result.totalPaid
  })
}
