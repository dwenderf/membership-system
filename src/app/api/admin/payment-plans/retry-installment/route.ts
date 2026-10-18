import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { processDuePayments } from '@/lib/services/payment-plan-processor'

/**
 * POST /api/admin/payment-plans/retry-installment
 * Body: { installmentId: string }
 *
 * Admin-initiated retry of a single payment plan installment that has a failed
 * charge (it went back to 'planned' with a recorded failure). Works even if the
 * automatic attempts are exhausted; typically used after the member replaces
 * their card. Refuses installments that have not failed, so it can't be used to
 * charge a member ahead of schedule.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const installmentId = typeof body?.installmentId === 'string' ? body.installmentId : null
    if (!installmentId) {
      return NextResponse.json({ error: 'installmentId is required' }, { status: 400 })
    }

    const adminSupabase = createAdminClient()
    const { data: installment, error: lookupError } = await adminSupabase
      .from('xero_payments')
      .select('id, sync_status, attempt_count, failure_reason, payment_type')
      .eq('id', installmentId)
      .single()

    if (lookupError || !installment || installment.payment_type !== 'installment') {
      return NextResponse.json({ error: 'Installment not found' }, { status: 404 })
    }

    if (installment.sync_status !== 'planned' || !(installment.attempt_count > 0) || !installment.failure_reason) {
      return NextResponse.json(
        { error: 'Only an installment with a failed payment can be retried' },
        { status: 400 }
      )
    }

    logger.logAdminAction(
      'retry-installment-start',
      'Admin retrying failed payment plan installment',
      { installmentId, attemptCount: installment.attempt_count },
      authUser.id
    )

    const today = new Date().toISOString().split('T')[0]
    const results = await processDuePayments(today, {
      includeExhausted: true,
      onlyPaymentIds: [installmentId]
    })

    if (results.paymentsProcessed > 0) {
      return NextResponse.json({ success: true, message: 'Payment processed successfully', results })
    }

    // The charge was attempted (or could not be) and did not go through
    const reason = results.errors[0]?.replace(/^Payment [^:]+: /, '') || 'Payment could not be processed'
    return NextResponse.json({ success: false, error: reason, results })
  } catch (error) {
    logger.logAdminAction(
      'retry-installment-error',
      'Error retrying payment plan installment',
      { error: error instanceof Error ? error.message : String(error) },
      undefined,
      'error',
      error
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
