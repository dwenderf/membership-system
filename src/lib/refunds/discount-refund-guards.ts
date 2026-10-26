/**
 * #454 server-side guards for discount-code refunds, shared by /api/validate-discount-code and
 * /api/admin/refunds/preview so a refund can't be staged just because a client says it's valid.
 *
 * - The original ACCREC invoice must exist (it is the source of the top-line price; no fallback).
 * - The code must not already have been used on this payment: neither on the original invoice
 *   nor on an earlier discount-refund credit note (ACCRECCREDIT) for the same payment.
 * - Any lookup error fails closed.
 */
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Credit notes that count as an applied refund (staged previews and ignored ones do not). */
export const APPLIED_SYNC_STATUSES = ['synced', 'pending']

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

    const { data: refundLines, error: refundLineError } = await supabase
      .from('xero_invoice_line_items')
      .select('id, xero_invoices!inner(payment_id, invoice_type, sync_status)')
      .eq('discount_code_id', discountCodeId)
      .eq('line_item_type', 'discount')
      .eq('xero_invoices.payment_id', paymentId)
      .eq('xero_invoices.invoice_type', 'ACCRECCREDIT')
      .in('xero_invoices.sync_status', APPLIED_SYNC_STATUSES)
    if (refundLineError || !Array.isArray(refundLines)) return { status: 'error' }
    if (refundLines.length > 0) return { status: 'reused', source: 'refund' }

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
