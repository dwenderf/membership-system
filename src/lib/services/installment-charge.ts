/**
 * Settling a payment plan installment charge (#461).
 *
 * An installment row moves planned -> processing when a charge attempt claims it, and
 * processing -> pending (ready for Xero) once its PaymentIntent succeeds. Both the cron's own
 * charge path and the Stripe webhook settle a charge through these helpers, so whichever runs
 * first does the work and the other is a no-op:
 *
 * - completeInstallmentCharge: the conditional processing -> pending update is the claim. Only the
 *   caller that wins it creates the payments row, so the sync path and the webhook can't both
 *   create one.
 * - releaseFailedInstallmentCharge: a PaymentIntent that failed after returning 'processing'
 *   goes back to planned for the next retry, but only if the row is still on that same attempt.
 */
import type Stripe from 'stripe'
import { logger } from '@/lib/logging/logger'

/* eslint-disable @typescript-eslint/no-explicit-any */
type SupabaseLike = { from: (table: string) => any }

/** Statuses an installment row can be in once its charge has been settled. */
const SETTLED_STATUSES = ['pending', 'synced']

/** Statuses of an early payoff `full` row that still count (same set as the #466 unique index). */
export const LIVE_PAYOFF_STATUSES = ['staged', 'pending', 'processing', 'synced', 'failed']

export type InstallmentCompletion =
  | { status: 'completed'; paymentId: string | null }
  | { status: 'already_done' }
  | { status: 'not_found' }
  | { status: 'not_processing'; syncStatus: string }

/** Stripe idempotency key for one charge attempt of one installment. */
export function installmentIdempotencyKey(xeroPaymentId: string, attempt: number): string {
  return `installment:${xeroPaymentId}:a${attempt}`
}

/**
 * True when the PaymentIntent belongs to another charge attempt than the one the row is on now.
 * Intents created by the charge path carry `attemptNumber`; older intents don't, so for those the
 * row must already name the intent.
 */
function isOtherAttempt(row: any, paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata'>): boolean {
  const attempt = paymentIntent.metadata?.attemptNumber
  if (attempt) return String(row.attempt_count) !== attempt
  return row.staging_metadata?.stripe_payment_intent_id !== paymentIntent.id
}

export async function completeInstallmentCharge(
  supabase: SupabaseLike,
  xeroPaymentId: string,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata' | 'amount'>,
  userId: string
): Promise<InstallmentCompletion> {
  const { data: row, error } = await supabase.from('xero_payments').select('*').eq('id', xeroPaymentId).maybeSingle()
  if (error) throw error
  if (!row) return { status: 'not_found' }

  if (row.sync_status !== 'processing') {
    if (SETTLED_STATUSES.includes(row.sync_status) && row.staging_metadata?.stripe_payment_intent_id === paymentIntent.id) {
      return { status: 'already_done' }
    }
    return { status: 'not_processing', syncStatus: row.sync_status }
  }
  if (isOtherAttempt(row, paymentIntent)) {
    return { status: 'not_processing', syncStatus: row.sync_status }
  }

  const processedAt = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase
    .from('xero_payments')
    .update({
      sync_status: 'pending',
      failure_reason: null,
      staging_metadata: {
        ...(row.staging_metadata || {}),
        stripe_payment_intent_id: paymentIntent.id,
        processed_at: processedAt
      }
    })
    .eq('id', xeroPaymentId)
    .eq('sync_status', 'processing')
    .eq('attempt_count', row.attempt_count)
    .select('id, staging_metadata')
  if (claimError) throw claimError
  if (!claimed || claimed.length === 0) {
    // The other path (sync or webhook) settled it, or a newer attempt claimed it, since the read.
    return { status: 'already_done' }
  }

  // This caller won the claim, so it alone records the payment.
  const { data: paymentRecord, error: paymentError } = await supabase
    .from('payments')
    .insert({
      user_id: userId,
      total_amount: paymentIntent.amount,
      final_amount: paymentIntent.amount,
      stripe_payment_intent_id: paymentIntent.id,
      status: 'completed',
      payment_method: 'stripe',
      completed_at: processedAt
    })
    .select()
    .single()

  if (paymentError || !paymentRecord) {
    // The money is collected and the row is queued for Xero; only the payments row is missing.
    logger.logPaymentProcessing(
      'payment-plan-installment-payment-record-error',
      'CRITICAL: installment charged and queued for Xero, but its payments record failed to create - ADMIN INTERVENTION REQUIRED',
      {
        xeroPaymentId,
        paymentIntentId: paymentIntent.id,
        error: paymentError?.message,
        recovery: 'Create a completed payments row for this payment intent and put its id in the xero_payments row\'s staging_metadata.payment_id.'
      },
      'error'
    )
    return { status: 'completed', paymentId: null }
  }

  const { error: linkError } = await supabase
    .from('xero_payments')
    .update({ staging_metadata: { ...(claimed[0].staging_metadata || {}), payment_id: paymentRecord.id } })
    .eq('id', xeroPaymentId)
  if (linkError) {
    logger.logPaymentProcessing(
      'payment-plan-installment-link-error',
      'Installment payment recorded but not linked on its xero_payments row',
      { xeroPaymentId, paymentId: paymentRecord.id, error: linkError.message },
      'warn'
    )
  }

  return { status: 'completed', paymentId: paymentRecord.id }
}

export type InstallmentRelease = { status: 'released' } | { status: 'ignored'; reason: string }

export async function releaseFailedInstallmentCharge(
  supabase: SupabaseLike,
  xeroPaymentId: string,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata' | 'last_payment_error'>
): Promise<InstallmentRelease> {
  const { data: row, error } = await supabase.from('xero_payments').select('*').eq('id', xeroPaymentId).maybeSingle()
  if (error) throw error
  if (!row) return { status: 'ignored', reason: 'not_found' }
  if (row.sync_status !== 'processing') return { status: 'ignored', reason: `status ${row.sync_status}` }
  // Only release the attempt this intent belongs to, so a late event from an older attempt can't
  // put a newer attempt's row back to planned while its charge is in flight.
  if (isOtherAttempt(row, paymentIntent)) return { status: 'ignored', reason: 'other_attempt' }

  const reason = paymentIntent.last_payment_error?.message || 'Payment failed after processing'
  const { data: released, error: releaseError } = await supabase
    .from('xero_payments')
    .update({ sync_status: 'planned', failure_reason: reason })
    .eq('id', xeroPaymentId)
    .eq('sync_status', 'processing')
    // Still the attempt checked above: a newer attempt claimed since the read stays in flight.
    .eq('attempt_count', row.attempt_count)
    .select('id')
  if (releaseError) throw releaseError
  if (!released || released.length === 0) return { status: 'ignored', reason: 'no_longer_processing' }
  return { status: 'released' }
}
