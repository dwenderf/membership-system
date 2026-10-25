import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { handleEarlyPayoffRequest } from '@/lib/payment-plans/early-payoff-request'

/**
 * Legacy early-payoff endpoint. It used to read a `payment_plans` table that no longer exists
 * (so it always returned 404). It now goes through the same handler as
 * /api/user/payment-plans/early-payoff, with the same ownership check and server-side guards (#452).
 * [id] is the payment plan's xero_invoice_id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: paymentPlanId } = await params
    return await handleEarlyPayoffRequest(supabase, user.id, paymentPlanId)
  } catch (error) {
    logger.logPaymentProcessing(
      'early-payoff-exception',
      'Exception during early payoff processing',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
