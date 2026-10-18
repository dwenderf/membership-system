import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentPlanSummaryRow } from '@/lib/payment-plan-utils'

/**
 * Starting a payment plan checkout stages a DRAFT Xero invoice with four 'staged'
 * installments before anything is paid. When checkout completes successfully the
 * completion processor sets the invoice to AUTHORISED (whether or not any installment
 * has been charged yet); an abandoned checkout stays DRAFT forever.
 *
 * payment_plan_summary doesn't expose that, and counts 'staged' installments as upcoming,
 * so an abandoned checkout shows up there as an 'active' plan. These helpers drop them.
 */
export const ABANDONED_PLAN_INVOICE_STATUS = 'DRAFT'

const PAGE_SIZE = 1000

/** Ids of payment plan invoices whose checkout never completed (optionally for one user). */
export async function fetchAbandonedPlanInvoiceIds(
  adminSupabase: SupabaseClient,
  userId?: string
): Promise<Set<string>> {
  const ids = new Set<string>()

  // Paged because PostgREST caps a response at 1000 rows
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = adminSupabase
      .from('xero_invoices')
      .select('id')
      .eq('is_payment_plan', true)
      .eq('invoice_status', ABANDONED_PLAN_INVOICE_STATUS)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)

    if (userId) {
      query = query.eq('staging_metadata->>user_id', userId)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to load abandoned payment plan invoices: ${error.message}`)

    for (const row of data ?? []) ids.add(row.id)
    if (!data || data.length < PAGE_SIZE) break
  }

  return ids
}

/**
 * payment_plan_summary rows for plans that were actually started, i.e. excluding
 * abandoned checkouts. Pass `contactId` to limit to one user (never pass a list of
 * ids to `.in()` instead: with hundreds of users it overflows the URL limit).
 */
export async function fetchStartedPlanSummaries(
  adminSupabase: SupabaseClient,
  options: { contactId?: string; statuses?: string[] } = {}
): Promise<{ plans: PaymentPlanSummaryRow[]; error: string | null }> {
  let query = adminSupabase.from('payment_plan_summary').select('*')
  if (options.contactId) query = query.eq('contact_id', options.contactId)
  if (options.statuses) query = query.in('status', options.statuses)

  const [{ data, error }, abandonedIds] = await Promise.all([
    query.overrideTypes<PaymentPlanSummaryRow[], { merge: false }>(),
    fetchAbandonedPlanInvoiceIds(adminSupabase, options.contactId).catch(e => e as Error)
  ])

  if (error) return { plans: [], error: error.message }
  if (abandonedIds instanceof Error) return { plans: [], error: abandonedIds.message }

  return { plans: (data ?? []).filter(plan => !abandonedIds.has(plan.invoice_id)), error: null }
}
