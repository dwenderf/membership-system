/**
 * Early payoff completion (#452).
 *
 * One idempotent "mark paid" step for an early-payoff PaymentIntent that has succeeded. It is
 * called synchronously by PaymentPlanService.processEarlyPayoff as soon as Stripe reports
 * `succeeded`, and again by the stripe-webhook handler as a backstop. Whichever runs first does
 * the transition; the other is a no-op (apart from filling in Stripe fee data when it has it).
 *
 * Every write is conditional on the row's current status, so concurrent or repeated calls can't
 * double-apply anything.
 */
import type Stripe from 'stripe'

// Minimal structural type so both the admin client and test fakes fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any }

/** xero_payments statuses that make an early-payoff row "live" (mirrors the unique index). */
export const LIVE_EARLY_PAYOFF_STATUSES = ['staged', 'pending', 'processing', 'synced'] as const

/** xero_payments statuses that mean a payoff charge is still in flight (not yet marked paid). */
export const IN_FLIGHT_EARLY_PAYOFF_STATUSES = ['staged', 'processing'] as const

/**
 * Whether an invoice has an early payoff in flight (staged/processing full row flagged
 * early_payoff). The installment cron skips these invoices.
 */
export async function hasEarlyPayoffInFlight(supabase: SupabaseLike, xeroInvoiceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('xero_payments')
    .select('id')
    .eq('xero_invoice_id', xeroInvoiceId)
    .eq('payment_type', 'full')
    .eq('staging_metadata->>early_payoff', 'true')
    .in('sync_status', [...IN_FLIGHT_EARLY_PAYOFF_STATUSES])
    .limit(1)
  if (error) throw new Error(`Failed to check for in-flight early payoff: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

export interface CompleteEarlyPayoffOptions {
  stripeFeeAmount?: number
  stripeChargeId?: string | null
}

export interface CompleteEarlyPayoffResult {
  paymentId: string
  xeroPaymentId: string
  /** True when this call performed the staged -> pending transition. */
  transitioned: boolean
}

/**
 * Mark an early payoff as paid: payments row -> completed, staged early-payoff xero_payments row
 * -> pending (ready for Xero sync). Safe to call any number of times for the same PaymentIntent.
 * Throws if the records can't be found (the webhook relies on that to get a retry).
 */
export async function completeEarlyPayoff(
  supabase: SupabaseLike,
  paymentIntent: Pick<Stripe.PaymentIntent, 'id' | 'metadata'>,
  options: CompleteEarlyPayoffOptions = {}
): Promise<CompleteEarlyPayoffResult> {
  const paymentId = paymentIntent.metadata?.paymentId
  const xeroInvoiceId = paymentIntent.metadata?.xeroStagingRecordId
  if (!paymentId || !xeroInvoiceId) {
    throw new Error(`Early payoff PaymentIntent ${paymentIntent.id} is missing paymentId/xeroStagingRecordId metadata`)
  }

  const now = new Date().toISOString()
  const fees: Record<string, unknown> = {}
  if (options.stripeFeeAmount !== undefined) fees.stripe_fee_amount = options.stripeFeeAmount
  if (options.stripeChargeId) fees.stripe_charge_id = options.stripeChargeId

  // 1. payments: pending -> completed (conditional, so completed_at is only set once)
  const { error: completeError } = await supabase
    .from('payments')
    .update({ status: 'completed', completed_at: now, stripe_payment_intent_id: paymentIntent.id, ...fees })
    .eq('id', paymentId)
    .eq('status', 'pending')
  if (completeError) throw new Error(`Failed to complete early payoff payment: ${completeError.message}`)

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('id, status')
    .eq('id', paymentId)
    .maybeSingle()
  if (paymentError || !payment) {
    throw new Error(`Early payoff payment record ${paymentId} not found${paymentError ? `: ${paymentError.message}` : ''}`)
  }
  if (payment.status !== 'completed') {
    throw new Error(`Early payoff payment record ${paymentId} is '${payment.status}', expected completed`)
  }
  // Fee data arrives with the webhook; record it even if the sync path already completed the row.
  if (Object.keys(fees).length > 0) {
    const { error: feeError } = await supabase.from('payments').update(fees).eq('id', paymentId)
    if (feeError) throw new Error(`Failed to record early payoff fees: ${feeError.message}`)
  }

  // 2. Find the early-payoff xero_payments row by PaymentIntent id, then by payment id.
  //    (Rows staged before #452 carry neither; fall back to the old invoice lookup, but only
  //    when it is unambiguous.)
  const xeroPayment = await findEarlyPayoffRow(supabase, paymentIntent.id, paymentId, xeroInvoiceId)

  let transitioned = false
  if (xeroPayment.sync_status === 'staged') {
    const { data: updated, error: updateError } = await supabase
      .from('xero_payments')
      .update({
        sync_status: 'pending',
        staging_metadata: {
          ...(xeroPayment.staging_metadata || {}),
          payment_id: paymentId,
          stripe_payment_intent_id: paymentIntent.id,
          ...(options.stripeChargeId ? { stripe_charge_id: options.stripeChargeId } : {}),
          processed_at: now
        }
      })
      .eq('id', xeroPayment.id)
      .eq('sync_status', 'staged')
      .select('id')
    if (updateError) throw new Error(`Failed to mark early payoff xero_payment pending: ${updateError.message}`)
    transitioned = Array.isArray(updated) && updated.length > 0
  } else if (options.stripeChargeId && !xeroPayment.staging_metadata?.stripe_charge_id) {
    // Already pending/synced via the sync path: just add the charge id the webhook knows.
    const { error: metaError } = await supabase
      .from('xero_payments')
      .update({ staging_metadata: { ...(xeroPayment.staging_metadata || {}), stripe_charge_id: options.stripeChargeId } })
      .eq('id', xeroPayment.id)
      .in('sync_status', ['pending'])
    if (metaError) throw new Error(`Failed to record early payoff charge id: ${metaError.message}`)
  }

  return { paymentId, xeroPaymentId: xeroPayment.id, transitioned }
}

interface EarlyPayoffRow {
  id: string
  sync_status: string
  staging_metadata: Record<string, unknown> | null
}

async function findEarlyPayoffRow(
  supabase: SupabaseLike,
  paymentIntentId: string,
  paymentId: string,
  xeroInvoiceId: string
): Promise<EarlyPayoffRow> {
  const base = () =>
    supabase
      .from('xero_payments')
      .select('id, sync_status, staging_metadata')
      .eq('xero_invoice_id', xeroInvoiceId)
      .eq('payment_type', 'full')

  for (const [key, value] of [
    ['staging_metadata->>stripe_payment_intent_id', paymentIntentId],
    ['staging_metadata->>payment_id', paymentId]
  ] as const) {
    const { data, error } = await base().eq(key, value).limit(2)
    if (error) throw new Error(`Failed to look up early payoff xero_payment: ${error.message}`)
    if (Array.isArray(data) && data.length === 1) return data[0] as EarlyPayoffRow
    if (Array.isArray(data) && data.length > 1) {
      throw new Error(`Multiple early payoff xero_payments match ${key}=${value}; manual review needed`)
    }
  }

  // Legacy rows (staged before #452): the single staged full row on the invoice.
  const { data, error } = await base().eq('sync_status', 'staged').limit(2)
  if (error) throw new Error(`Failed to look up early payoff xero_payment: ${error.message}`)
  if (Array.isArray(data) && data.length === 1) return data[0] as EarlyPayoffRow
  throw new Error(
    data && data.length > 1
      ? `Multiple staged early payoff rows on invoice ${xeroInvoiceId}; manual review needed`
      : `No early payoff xero_payment found for PaymentIntent ${paymentIntentId}`
  )
}
