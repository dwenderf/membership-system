import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Link a payment to the Xero staging invoice created for THIS checkout.
 *
 * Scope the update to that one invoice by id. An earlier version of the payment-intent routes
 * updated every staged invoice for the user whose payment_id was still null, which stamped each
 * new purchase's payment onto all of the member's old abandoned carts (other items, other prices).
 * Those carts then looked like staged invoices with a payment, so the cart sweep could not
 * safely abandon them.
 */
export function linkPaymentToStagingInvoice(
  adminSupabase: SupabaseClient,
  stagingInvoiceId: string,
  paymentId: string
) {
  return adminSupabase
    .from('xero_invoices')
    .update({ payment_id: paymentId })
    .eq('id', stagingInvoiceId)
    .eq('sync_status', 'staged')
    .is('payment_id', null)
}
