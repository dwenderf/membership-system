/**
 * #454 server-side guards for discount-code refunds, shared by /api/validate-discount-code and
 * /api/admin/refunds/preview so a refund can't be staged just because a client says it's valid.
 *
 * - The original ACCREC invoice must exist (it is the source of the top-line price; no fallback).
 * - The code must not already have been used on this payment: neither on the original invoice
 *   nor in an earlier refund. An earlier refund uses the code from the moment it is initiated
 *   (its refunds row exists and isn't failed/cancelled), regardless of credit-note sync state.
 * - Any lookup error fails closed.
 */
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** ACCREC invoice statuses that count as the original invoice. */
export const APPLIED_SYNC_STATUSES = ['synced', 'pending']

/** Refund statuses that free a discount code again; every other status (pending, completed...) uses it. */
export const RELEASED_REFUND_STATUSES = ['failed', 'cancelled']

/** Credit notes without a refund_id that still count as used (they are going to / in Xero). */
const LEGACY_APPLIED_SYNC_STATUSES = ['synced', 'pending', 'processing']

type CreditNoteRow = { payment_id: string; invoice_type: string; sync_status: string; staging_metadata: { refund_id?: string | null } | null }
type CreditNoteLine = { id: string; xero_invoices: CreditNoteRow | CreditNoteRow[] | null }

export const MISSING_ORIGINAL_INVOICE_ERROR =
  "This refund can't be processed: the original invoice for this payment is missing, so the full price can't be determined."

export type OriginalInvoiceCheck =
  | { status: 'ok'; invoiceId: string }
  | { status: 'missing' }
  | { status: 'multiple' }

export async function findOriginalInvoice(supabase: Supabase, paymentId: string | null | undefined): Promise<OriginalInvoiceCheck> {
  if (!paymentId) return { status: 'missing' }
  try {
    const { data, error } = await supabase
      .from('xero_invoices')
      .select('id')
      .eq('payment_id', paymentId)
      .eq('invoice_type', 'ACCREC')
      .in('sync_status', APPLIED_SYNC_STATUSES)
    if (error || !Array.isArray(data) || data.length === 0) return { status: 'missing' }
    if (data.length > 1) return { status: 'multiple' }
    return { status: 'ok', invoiceId: data[0].id }
  } catch {
    return { status: 'missing' }
  }
}

export type CodeReuseCheck =
  | { status: 'unused' }
  | { status: 'reused'; source: 'invoice' | 'refund' }
  | { status: 'multiple' }
  | { status: 'error' }

export async function checkDiscountCodeReuse(
  supabase: Supabase,
  paymentId: string,
  originalInvoiceId: string,
  discountCodeId: string
): Promise<CodeReuseCheck> {
  try {
    const { data: invoiceLines, error: invoiceLineError } = await supabase
      .from('xero_invoice_line_items')
      .select('id, line_amount')
      .eq('xero_invoice_id', originalInvoiceId)
      .eq('discount_code_id', discountCodeId)
      .eq('line_item_type', 'discount')
    if (invoiceLineError || !Array.isArray(invoiceLines)) return { status: 'error' }
    if (invoiceLines.length > 1) return { status: 'multiple' }
    if (invoiceLines.length === 1) return { status: 'reused', source: 'invoice' }

    // Earlier discount refunds on this payment. A code counts as used as soon as a refund is
    // initiated (refunds row pending or completed, whatever the credit note's Xero sync state) and
    // is freed only when that refund is failed or cancelled (#456 review).
    const { data: refundLines, error: refundLineError } = await supabase
      .from('xero_invoice_line_items')
      .select('id, xero_invoices!inner(payment_id, invoice_type, sync_status, staging_metadata)')
      .eq('discount_code_id', discountCodeId)
      .eq('line_item_type', 'discount')
      .eq('xero_invoices.payment_id', paymentId)
      .eq('xero_invoices.invoice_type', 'ACCRECCREDIT')
    if (refundLineError || !Array.isArray(refundLines)) return { status: 'error' }

    const refundIds = new Set<string>()
    for (const line of refundLines as CreditNoteLine[]) {
      const note = Array.isArray(line.xero_invoices) ? line.xero_invoices[0] : line.xero_invoices
      const refundId = note?.staging_metadata?.refund_id
      if (refundId) {
        refundIds.add(refundId)
      } else if (note && LEGACY_APPLIED_SYNC_STATUSES.includes(note.sync_status)) {
        // A credit note headed to Xero with no refund record attached (e.g. created before
        // refund_id was recorded): treat as used, fail closed.
        return { status: 'reused', source: 'refund' }
      }
      // Otherwise it is a preview that was never confirmed (no refund initiated): not used.
    }
    if (refundIds.size === 0) return { status: 'unused' }

    const { data: refunds, error: refundsError } = await supabase
      .from('refunds')
      .select('id, status')
      .in('id', [...refundIds])
    if (refundsError || !Array.isArray(refunds)) return { status: 'error' }

    const byId = new Map((refunds as { id: string; status: string }[]).map(r => [r.id, r.status]))
    for (const id of refundIds) {
      const status = byId.get(id)
      // A referenced refund row we can't see fails closed.
      if (!status || !RELEASED_REFUND_STATUSES.includes(status)) return { status: 'reused', source: 'refund' }
    }

    return { status: 'unused' }
  } catch {
    return { status: 'error' }
  }
}

export function reusedCodeError(code: string, source: 'invoice' | 'refund'): string {
  return source === 'invoice'
    ? `${code} was already applied to this payment, so it can't be applied again as a refund.`
    : `${code} was already applied in an earlier refund on this payment, so it can't be applied again.`
}

export function reuseLookupFailedError(code: string): string {
  return `Couldn't check whether ${code} was already used on this payment, so it can't be applied right now. Please try again.`
}

/**
 * Season of the registration a payment is for: via user_registrations, or via
 * alternate_selections for alternate payments (the same two paths discount_usage_computed uses).
 */
export async function resolvePaymentSeasonId(supabase: Supabase, paymentId: string): Promise<{ status: 'ok'; seasonId: string } | { status: 'missing' | 'error' }> {
  type SeasonRow = { season_id: string | null } | { season_id: string | null }[] | null
  const one = (r: SeasonRow) => (Array.isArray(r) ? r[0] : r)?.season_id || null
  try {
    const { data: regs, error: regError } = await supabase
      .from('user_registrations')
      .select('registrations(season_id)')
      .eq('payment_id', paymentId)
    if (regError) return { status: 'error' }
    for (const r of (regs || []) as { registrations: SeasonRow }[]) {
      const seasonId = one(r.registrations)
      if (seasonId) return { status: 'ok', seasonId }
    }
    const { data: alts, error: altError } = await supabase
      .from('alternate_selections')
      .select('alternate_registrations(registrations(season_id))')
      .eq('payment_id', paymentId)
    if (altError) return { status: 'error' }
    type AltReg = { registrations: SeasonRow }
    for (const a of (alts || []) as { alternate_registrations: AltReg | AltReg[] | null }[]) {
      const ar = Array.isArray(a.alternate_registrations) ? a.alternate_registrations[0] : a.alternate_registrations
      const seasonId = ar ? one(ar.registrations) : null
      if (seasonId) return { status: 'ok', seasonId }
    }
    return { status: 'missing' }
  } catch {
    return { status: 'error' }
  }
}
