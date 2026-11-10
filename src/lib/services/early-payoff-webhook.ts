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
    // Another delivery of this event got there first.
    logger.logXeroSync('early-payoff-already-marked', 'Early payoff row was no longer staged; treating as already handled', { paymentIntentId: paymentIntent.id, xeroPaymentId: row.id }, 'info')
    return { status: 'already_done', xeroPaymentId: row.id }
  }

  return { status: 'marked_pending', xeroPaymentId: row.id }
}
