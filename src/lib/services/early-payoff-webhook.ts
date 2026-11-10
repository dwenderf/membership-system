/**
 * Webhook half of an early payoff (#466): moves the staged `full` xero_payment for a succeeded
 * payoff PaymentIntent to 'pending' so it syncs to Xero.
 *
 * The row is found by its id, which processEarlyPayoff puts in the intent's metadata as
 * `xeroStagedPaymentId`. Intents created before that field existed only carry the invoice id, so
 * for those we fall back to the invoice, and refuse to guess when more than one staged payoff row
 * matches. The update only applies to a row that is still 'staged', so a repeat delivery of the
 * same event is a no-op.
 *
 * Outcomes other than 'marked_pending' and 'already_done' are permanent mismatches that a Stripe
 * retry cannot fix, so the caller logs them for an admin instead of throwing (which would make
 * Stripe retry for days).
 */
import type Stripe from 'stripe'
import { logger } from '@/lib/logging/logger'
import { LIVE_PAYOFF_STATUSES } from './installment-charge'

/* eslint-disable @typescript-eslint/no-explicit-any */
type SupabaseLike = { from: (table: string) => any }

export type EarlyPayoffWebhookOutcome =
  | { status: 'marked_pending'; xeroPaymentId: string }
  | { status: 'already_done'; xeroPaymentId: string }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidateIds: string[] }
  | { status: 'needs_review'; xeroPaymentId: string; syncStatus: string }

// Statuses a payoff row can be in once the webhook (or a previous delivery of it) has handled it.
const HANDLED_STATUSES = ['pending', 'processing', 'synced', 'failed']

export async function completeEarlyPayoffStagedPayment(
  supabase: SupabaseLike,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata'>,
  details: { paymentId: string; chargeId: string | null }
): Promise<EarlyPayoffWebhookOutcome> {
  const stagedId = paymentIntent.metadata?.xeroStagedPaymentId
  const invoiceId = paymentIntent.metadata?.xeroStagingRecordId

  let row: any = null

  if (stagedId) {
    const { data, error } = await supabase.from('xero_payments').select('*').eq('id', stagedId).maybeSingle()
    if (error) throw error
    row = data
  } else if (invoiceId) {
    // Legacy intents (created before xeroStagedPaymentId): look at every early payoff row on the invoice.
    const { data, error } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('xero_invoice_id', invoiceId)
      .eq('payment_type', 'full')
      .eq('staging_metadata->>early_payoff', 'true')
      .in('sync_status', ['staged', ...HANDLED_STATUSES])
    if (error) throw error
    const rows: any[] = data || []
    const handledByThisIntent = rows.find(r => r.staging_metadata?.stripe_payment_intent_id === paymentIntent.id)
    if (handledByThisIntent) return { status: 'already_done', xeroPaymentId: handledByThisIntent.id }
    const staged = rows.filter(r => r.sync_status === 'staged')
    if (staged.length > 1) return { status: 'ambiguous', candidateIds: staged.map(r => r.id) }
    row = staged[0] ?? null
  }

  if (!row) return { status: 'not_found' }

  if (row.sync_status !== 'staged') {
    if (HANDLED_STATUSES.includes(row.sync_status)) return { status: 'already_done', xeroPaymentId: row.id }
    // e.g. 'cancelled' by a rollback even though the charge went through (#462)
    return { status: 'needs_review', xeroPaymentId: row.id, syncStatus: row.sync_status }
  }

  const { data: updated, error: updateError } = await supabase
    .from('xero_payments')
    .update({
      sync_status: 'pending',
      staging_metadata: {
        ...(row.staging_metadata || {}),
        payment_id: details.paymentId,
        stripe_payment_intent_id: paymentIntent.id,
        stripe_charge_id: details.chargeId,
        processed_at: new Date().toISOString()
      }
    })
    .eq('id', row.id)
    .eq('sync_status', 'staged')
    .select('id')
  if (updateError) throw updateError

  if (!updated || updated.length === 0) {
    // The row left 'staged' between the read and the update: re-read it to see whether another
    // delivery handled it or something else (e.g. a rollback) moved it.
    const { data: current, error: rereadError } = await supabase.from('xero_payments').select('*').eq('id', row.id).maybeSingle()
    if (rereadError) throw rereadError
    if (current && HANDLED_STATUSES.includes(current.sync_status)) {
      logger.logXeroSync('early-payoff-already-marked', 'Early payoff row was no longer staged; treating as already handled', { paymentIntentId: paymentIntent.id, xeroPaymentId: row.id }, 'info')
      return { status: 'already_done', xeroPaymentId: row.id }
    }
    if (!current) return { status: 'not_found' }
    return { status: 'needs_review', xeroPaymentId: row.id, syncStatus: current.sync_status }
  }

  return { status: 'marked_pending', xeroPaymentId: row.id }
}

/** Reason the installment rows carry while an early payoff covers them (set by processEarlyPayoff). */
const SUPERSEDED_REASON = 'Superseded by early payoff payment'

export type EarlyPayoffFailureOutcome =
  | { status: 'rolled_back'; xeroPaymentId: string; restoredInstallments: number }
  | { status: 'already_rolled_back'; xeroPaymentId: string; restoredInstallments: number }
  | { status: 'already_handled' }
  | { status: 'not_found'; restoredInstallments: number }
  | { status: 'ambiguous'; candidateIds: string[] }
  | { status: 'needs_review'; xeroPaymentId: string; syncStatus: string }

/**
 * Webhook rollback for an early payoff whose PaymentIntent failed after returning 'processing'
 * (#462). processEarlyPayoff leaves that case to the webhook, so without this the installments
 * stay cancelled and the plan looks paid off with no money collected.
 *
 * - The staged payoff row goes staged -> cancelled (conditional, so this is the claim). It is
 *   cancelled rather than failed so payment_plan_summary doesn't show the plan as failed, and so
 *   the next payoff attempt gets a fresh Stripe idempotency key.
 * - The installments the payoff superseded go back to planned, but only while no other live payoff
 *   exists on the invoice: a late event for an old attempt must not undo a newer payoff.
 * - The payment record goes pending -> failed.
 *
 * Marking the payment failed is the last step here and in the charge path's own rollback, so a
 * payment that already reads failed means the rollback finished: a repeat delivery then touches
 * nothing. Without that, a repeat could pick a newer payoff's staged row (older intents, found by
 * invoice) or put back installments a newer payoff has just cancelled.
 *
 * Every step is conditional, so a delivery after a half-finished one completes it. Database errors
 * throw so Stripe retries the event.
 */
export async function rollbackFailedEarlyPayoff(
  supabase: SupabaseLike,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata' | 'last_payment_error'>
): Promise<EarlyPayoffFailureOutcome> {
  const stagedId = paymentIntent.metadata?.xeroStagedPaymentId
  const invoiceId = paymentIntent.metadata?.xeroStagingRecordId
  const reason = `Early payoff failed: ${paymentIntent.last_payment_error?.message || 'payment failed after processing'}`

  if ((await payoffPaymentStatus(supabase, paymentIntent)) === 'failed') {
    return { status: 'already_handled' }
  }

  let row: any = null
  if (stagedId) {
    const { data, error } = await supabase.from('xero_payments').select('*').eq('id', stagedId).maybeSingle()
    if (error) throw error
    row = data
  } else if (invoiceId) {
    // Legacy intents (created before xeroStagedPaymentId): only act when exactly one staged payoff row exists.
    const { data, error } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('xero_invoice_id', invoiceId)
      .eq('payment_type', 'full')
      .eq('staging_metadata->>early_payoff', 'true')
      .eq('sync_status', 'staged')
    if (error) throw error
    const staged: any[] = data || []
    if (staged.length > 1) return { status: 'ambiguous', candidateIds: staged.map(r => r.id) }
    row = staged[0] ?? null
  }

  if (!row || row.payment_type !== 'full' || row.staging_metadata?.early_payoff !== true) {
    // No staged row to cancel. For an older intent this can be a retry after an earlier delivery
    // cancelled the row and then failed, so still put back any installments no payoff covers.
    const restoredInstallments = !stagedId && invoiceId ? await restoreUncoveredInstallments(supabase, invoiceId) : 0
    await markPayoffPaymentFailed(supabase, paymentIntent)
    return { status: 'not_found', restoredInstallments }
  }

  let claimed = false
  let syncStatus: string = row.sync_status
  if (syncStatus === 'staged') {
    const { data: updated, error } = await supabase
      .from('xero_payments')
      .update({ sync_status: 'cancelled', failure_reason: reason })
      .eq('id', row.id)
      .eq('sync_status', 'staged')
      .select('id')
    if (error) throw error
    if (updated && updated.length > 0) {
      claimed = true
      syncStatus = 'cancelled'
    } else {
      const { data: current, error: rereadError } = await supabase.from('xero_payments').select('sync_status').eq('id', row.id).maybeSingle()
      if (rereadError) throw rereadError
      syncStatus = current?.sync_status ?? 'missing'
    }
  }

  if (syncStatus !== 'cancelled') {
    // e.g. pending or synced: the payoff was recorded as paid, so don't touch the plan.
    return { status: 'needs_review', xeroPaymentId: row.id, syncStatus }
  }

  const restoredInstallments = await restoreUncoveredInstallments(supabase, row.xero_invoice_id)

  await markPayoffPaymentFailed(supabase, paymentIntent)

  return claimed
    ? { status: 'rolled_back', xeroPaymentId: row.id, restoredInstallments }
    : { status: 'already_rolled_back', xeroPaymentId: row.id, restoredInstallments }
}

/**
 * Put the superseded installments on an invoice back to planned, unless a payoff on it is live now
 * (staged, paying or paid): with no live payoff, nothing covers them. Returns how many came back.
 */
async function restoreUncoveredInstallments(supabase: SupabaseLike, xeroInvoiceId: string): Promise<number> {
  const { data: livePayoffs, error: liveError } = await supabase
    .from('xero_payments')
    .select('id')
    .eq('xero_invoice_id', xeroInvoiceId)
    .eq('payment_type', 'full')
    .eq('staging_metadata->>early_payoff', 'true')
    .in('sync_status', LIVE_PAYOFF_STATUSES)
  if (liveError) throw liveError
  if (livePayoffs && livePayoffs.length > 0) return 0

  const { data: restored, error: restoreError } = await supabase
    .from('xero_payments')
    .update({ sync_status: 'planned', failure_reason: null })
    .eq('xero_invoice_id', xeroInvoiceId)
    .eq('payment_type', 'installment')
    .eq('sync_status', 'cancelled')
    .eq('failure_reason', SUPERSEDED_REASON)
    .select('id')
  if (restoreError) throw restoreError
  return restored?.length ?? 0
}

async function payoffPaymentStatus(
  supabase: SupabaseLike,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata'>
): Promise<string | null> {
  const paymentId = paymentIntent.metadata?.paymentId
  const query = supabase.from('payments').select('status')
  const { data, error } = await (paymentId ? query.eq('id', paymentId) : query.eq('stripe_payment_intent_id', paymentIntent.id))
  if (error) throw error
  const rows: any[] = Array.isArray(data) ? data : data ? [data] : []
  return rows.length === 1 ? rows[0].status : null
}

async function markPayoffPaymentFailed(
  supabase: SupabaseLike,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata'>
): Promise<void> {
  const paymentId = paymentIntent.metadata?.paymentId
  const query = supabase.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() })
  const { error } = await (paymentId ? query.eq('id', paymentId) : query.eq('stripe_payment_intent_id', paymentIntent.id))
    .eq('status', 'pending')
  if (error) throw error
}
