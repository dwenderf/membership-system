/**
 * Xero staging invoices that were never promoted for sync: a cart still 'staged', or one the
 * daily-housekeeping sweep marked 'abandoned'.
 *
 * Several of these can share a payment_id with the REAL invoice for that payment (old carts that were
 * stamped with a later purchase's payment before the payment link was scoped to its own invoice). Any
 * lookup of "the original invoice for this payment" must exclude them, or it can match a stale cart.
 * PostgREST `not ... in` list syntax.
 */
export const UNPROMOTED_INVOICE_STATUSES_FILTER = '(staged,abandoned)'
