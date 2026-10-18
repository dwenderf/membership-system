import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily-housekeeping sweep that marks Xero staging rows for never-completed
 * carts as 'abandoned'. Two branches, reported separately:
 *
 *  - before payment:      staged invoice with payment_id IS NULL (cart left before the Stripe step)
 *  - at/after payment:    staged invoice WITH a payment_id, only when its payment provably
 *                         never succeeded (see abandonCartsWithPayment)
 *
 * Background: payment_id is stamped at Stripe PaymentIntent creation, not completion. The
 * completion processor writes payment_id and sync_status 'pending' together, so a cart that
 * completed is 'pending', never 'staged'. Carts abandoned at or after the Stripe step
 * therefore stay 'staged' with a payment_id.
 */

export const STALE_CART_AGE_MS = 24 * 60 * 60 * 1000 // 1 day

export const ABANDONED_CART_REASON =
  'Automatically marked as abandoned - staged over 24 hours without payment completion'
export const ABANDONED_CART_WITH_PAYMENT_REASON =
  'Automatically marked as abandoned - staged with a payment that never completed'

/**
 * Payment statuses that mean the payment ended without success.
 *
 * 'pending' is deliberately NOT here. A pending payment can still complete arbitrarily late
 * (production has completions months after the cart was staged), and the completion processor
 * finds its Xero record by exact id restricted to staged/pending/synced: once that invoice is
 * 'abandoned' a late completion logs "staging record not found" and the invoice is never
 * promoted. Sweeping pending carts needs the processor to revive abandoned records first.
 */
const ENDED_PAYMENT_STATUSES = ['cancelled', 'failed']

/** Ids per .in() list: PostgREST puts them in the URL, and hundreds of UUIDs overflow its limit. */
const CHUNK_SIZE = 100
/** Upper bound of candidate invoices examined per run; a larger backlog drains over several runs. */
const MAX_CANDIDATES_PER_RUN = 1000

type Supabase = SupabaseClient

export interface StepResult {
  success: boolean
  error: string | null
}

export interface CartSweepResult extends StepResult {
  invoices: number
  payments: number
}

export interface CartWithPaymentSweepResult extends CartSweepResult {
  /** Staged invoices whose payment completed: unsynced revenue, never abandoned, needs a person. */
  needsReconciliation: number
}

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** PostgREST filter for "staged before `cutoff`", falling back to created_at when staged_at is unset. */
function staleFilter(cutoffIso: string): string {
  return `staged_at.lt.${cutoffIso},and(staged_at.is.null,created_at.lt.${cutoffIso})`
}

/**
 * Abandon the given invoices and their staged payments.
 *
 * Order matters. The payments update runs before the invoices update so that a failure on
 * the payments side leaves the invoice 'staged' rather than stranding an abandoned invoice
 * beside a staged payment. Both updates are idempotent, so a partial run simply completes on
 * the next pass. Payments are scoped to the invoices selected in this run.
 */
async function abandonInvoices(
  supabase: Supabase,
  invoiceIds: string[],
  reason: string
): Promise<CartSweepResult> {
  let invoices = 0
  let payments = 0

  for (const ids of chunk(invoiceIds)) {
    const { data: abandonedPayments, error: paymentError } = await supabase
      .from('xero_payments')
      .update({ sync_status: 'abandoned', sync_error: reason })
      .in('xero_invoice_id', ids)
      .eq('sync_status', 'staged')
      .select('id')

    if (paymentError) {
      return { success: false, error: `payments: ${paymentError.message}`, invoices, payments }
    }
    payments += abandonedPayments?.length || 0

    const { data: abandonedInvoices, error: invoiceError } = await supabase
      .from('xero_invoices')
      .update({ sync_status: 'abandoned', sync_error: reason })
      .in('id', ids)
      .eq('sync_status', 'staged')
      .select('id')

    if (invoiceError) {
      return { success: false, error: `invoices: ${invoiceError.message}`, invoices, payments }
    }
    invoices += abandonedInvoices?.length || 0
  }

  return { success: true, error: null, invoices, payments }
}

/**
 * Branch 1: invoices still 'staged' with payment_id null, past the age threshold.
 *
 * (The predecessor filtered on sync_status = 'pending', which is the live Xero sync queue
 * drained every 5 minutes by /api/cron/xero-sync, NOT the cart state. Never touch 'pending'.)
 */
export async function abandonCartsBeforePayment(supabase: Supabase): Promise<CartSweepResult> {
  const cutoff = new Date(Date.now() - STALE_CART_AGE_MS).toISOString()

  const { data: staleInvoices, error: selectError } = await supabase
    .from('xero_invoices')
    .select('id')
    .eq('sync_status', 'staged')
    .is('payment_id', null)
    .or(staleFilter(cutoff))

  if (selectError) {
    return { success: false, error: `select: ${selectError.message}`, invoices: 0, payments: 0 }
  }

  const invoiceIds = (staleInvoices || []).map((row: { id: string }) => row.id)
  if (invoiceIds.length === 0) {
    return { success: true, error: null, invoices: 0, payments: 0 }
  }

  return abandonInvoices(supabase, invoiceIds, ABANDONED_CART_REASON)
}

/**
 * Branch 2: invoices still 'staged' WITH a payment_id.
 *
 * Abandoned only when ALL of these hold, so successful payments are never touched:
 *  - the invoice is DRAFT: a completed checkout sets it to AUTHORISED, so an AUTHORISED invoice
 *    stuck at 'staged' is not a cart and is left for manual review;
 *  - its payment is cancelled/failed (the invoice is also older than STALE_CART_AGE_MS).
 *
 * Staged invoices whose payment COMPLETED are the "completion processor failed to promote it"
 * case: collected money that never reached the Xero queue. They are never abandoned; they are
 * counted in `needsReconciliation` so the cron response and log make them visible.
 */
export async function abandonCartsWithPayment(supabase: Supabase): Promise<CartWithPaymentSweepResult> {
  const empty = { invoices: 0, payments: 0, needsReconciliation: 0 }
  const cutoff = new Date(Date.now() - STALE_CART_AGE_MS).toISOString()

  const { data: candidates, error: selectError } = await supabase
    .from('xero_invoices')
    .select('id, payment_id, staged_at, created_at')
    .eq('sync_status', 'staged')
    .eq('invoice_status', 'DRAFT')
    .not('payment_id', 'is', null)
    .or(staleFilter(cutoff))
    .order('created_at', { ascending: true })
    .limit(MAX_CANDIDATES_PER_RUN)

  if (selectError) {
    return { success: false, error: `select: ${selectError.message}`, ...empty }
  }

  const rows = (candidates || []) as Array<{
    id: string
    payment_id: string
    staged_at: string | null
    created_at: string
  }>

  // Look up each candidate's payment status (chunked: see CHUNK_SIZE)
  const statusByPayment = new Map<string, string>()
  for (const ids of chunk([...new Set(rows.map(r => r.payment_id))])) {
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('id, status')
      .in('id', ids)

    if (paymentsError) {
      return { success: false, error: `payments lookup: ${paymentsError.message}`, ...empty }
    }
    for (const p of (payments || []) as Array<{ id: string; status: string }>) {
      statusByPayment.set(p.id, p.status)
    }
  }

  const eligibleIds: string[] = []
  let needsReconciliation = 0

  for (const row of rows) {
    const status = statusByPayment.get(row.payment_id)
    if (status === 'completed') {
      needsReconciliation++
    } else if (status && ENDED_PAYMENT_STATUSES.includes(status)) {
      eligibleIds.push(row.id)
    }
    // Anything else is left alone: pending (see ENDED_PAYMENT_STATUSES), refunded, or no payment row.
  }

  if (eligibleIds.length === 0) {
    return { success: true, error: null, ...empty, needsReconciliation }
  }

  const abandoned = await abandonInvoices(supabase, eligibleIds, ABANDONED_CART_WITH_PAYMENT_REASON)
  return { ...abandoned, needsReconciliation }
}
