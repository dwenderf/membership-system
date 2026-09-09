import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { authorizeCronRequest } from '@/lib/cron/auth'

/**
 * Daily housekeeping — replaces the former /api/cron/cleanup and
 * /api/cron/maintenance routes, which split this work between two ambiguously
 * named endpoints (only one of which was ever declared in vercel.json).
 *
 * Runs three independent sweeps, each reporting its own counters and errors so
 * one failing step never masks another:
 *
 *  1. expireAbandonedRegistrations — awaiting_payment rows the user never paid
 *  2. abandonStaleCarts            — staged Xero rows for carts never paid for
 *  3. pruneOldEmailLogs            — email_logs past the 90-day retention window
 *
 * NOTE on the cart sweep: the predecessor filtered xero_invoices/xero_payments
 * on sync_status = 'pending', which is NOT the cart state. 'pending' is the
 * live Xero sync queue, selected by get_pending_xero_invoices_with_lock and
 * drained every 5 minutes by /api/cron/xero-sync; refund credit notes and
 * manually retried failures enter it that way, and a row only lingers there
 * when a sync is stuck and needs attention. Abandoning those would drop real
 * accounting records out of the queue. The pre-payment cart state is 'staged'
 * with payment_id still null, which is what this sweep targets — matching
 * 2025-10-19-cleanup-old-staged-records.sql, the one-off migration that is the
 * only thing to have swept these before.
 *
 * Uses the service-role client deliberately. Every table touched here has RLS
 * enabled with policies keyed on auth.uid(), and a cron request carries no
 * session — under the anon client each statement silently matches zero rows
 * rather than erroring, which is how the predecessor route appeared to succeed
 * nightly while doing nothing.
 */

const ABANDONED_REGISTRATION_AGE_MS = 60 * 60 * 1000 // 1 hour
const STALE_CART_AGE_MS = 24 * 60 * 60 * 1000 // 1 day
const EMAIL_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

const ABANDONED_CART_REASON =
  'Automatically marked as abandoned - staged over 24 hours without payment completion'

type Supabase = ReturnType<typeof createAdminClient>

interface StepResult {
  success: boolean
  error: string | null
}

/**
 * Mark abandoned checkouts as expired.
 *
 * registered_at IS NULL is the safe signal for "never completed" — that field
 * is only written at payment completion, so it is null for any awaiting_payment
 * row abandoned before checkout finished. This correctly excludes 'refunded'
 * records (which have registered_at set because they were once paid) and any
 * other terminal status.
 *
 * We do NOT filter on reservation_expires_at because unlimited-capacity
 * categories never set that field, yet they can still be abandoned.
 */
async function expireAbandonedRegistrations(
  supabase: Supabase
): Promise<StepResult & { expired: number }> {
  const cutoff = new Date(Date.now() - ABANDONED_REGISTRATION_AGE_MS).toISOString()

  // Mark as 'expired' — distinct from 'failed' (which means Stripe rejected an
  // active payment attempt). 'expired' means the user started checkout but
  // never submitted payment.
  const { data, error } = await supabase
    .from('user_registrations')
    .update({ payment_status: 'expired', reservation_expires_at: null })
    .eq('payment_status', 'awaiting_payment')
    .is('registered_at', null)
    .lt('created_at', cutoff)
    .select('id')

  if (error) {
    return { success: false, error: error.message, expired: 0 }
  }

  return { success: true, error: null, expired: data?.length || 0 }
}

/**
 * Mark Xero staging rows for never-completed carts as abandoned.
 *
 * Targets invoices still 'staged' (the pre-payment state) with payment_id
 * null, past the age threshold.
 *
 * KNOWN LIMITATION — this is narrower than "all abandoned carts". payment_id is
 * stamped at payment-INTENT creation (create-registration-payment-intent),
 * not at completion: the completion processor writes payment_id and
 * sync_status 'pending' together in one update, so any row that completed is
 * 'pending', never 'staged'. A payment_id IS NULL guard therefore only matches
 * carts abandoned BEFORE the Stripe step. Carts abandoned at or after it keep
 * sitting at 'staged' with a payment_id and are not swept here.
 *
 * That guard is kept deliberately for now: among the rows it excludes are any
 * whose payment actually succeeded while the completion processor failed to
 * promote them (the processor logs those as needing manual reconciliation).
 * Those are unsynced revenue, not abandoned carts, and must not be marked
 * abandoned. Widening this sweep requires distinguishing the two by joining to
 * payments.status first.
 *
 * Order matters. The payments update runs before the invoices update so that a
 * failure on the payments side — for instance if
 * 2026-09-07-restore-abandoned-status-to-xero-payments.sql has not been applied
 * and the check constraint still rejects 'abandoned' — leaves the invoice
 * 'staged' rather than stranding an abandoned invoice beside a staged payment.
 * The reverse order would be the inconsistent one. Both updates are idempotent,
 * so a partial run simply completes on the next pass.
 *
 * Payments are scoped to the invoices selected in this run, unlike the one-off
 * migration, which matched every abandoned invoice in the table.
 */
async function abandonStaleCarts(
  supabase: Supabase
): Promise<StepResult & { invoices: number; payments: number }> {
  const cutoff = new Date(Date.now() - STALE_CART_AGE_MS).toISOString()
  const staleFilter = `staged_at.lt.${cutoff},and(staged_at.is.null,created_at.lt.${cutoff})`

  const { data: staleInvoices, error: selectError } = await supabase
    .from('xero_invoices')
    .select('id')
    .eq('sync_status', 'staged')
    .is('payment_id', null)
    .or(staleFilter)

  if (selectError) {
    return { success: false, error: `select: ${selectError.message}`, invoices: 0, payments: 0 }
  }

  const invoiceIds = (staleInvoices || []).map((row: { id: string }) => row.id)
  if (invoiceIds.length === 0) {
    return { success: true, error: null, invoices: 0, payments: 0 }
  }

  const { data: abandonedPayments, error: paymentError } = await supabase
    .from('xero_payments')
    .update({ sync_status: 'abandoned', sync_error: ABANDONED_CART_REASON })
    .in('xero_invoice_id', invoiceIds)
    .eq('sync_status', 'staged')
    .select('id')

  if (paymentError) {
    return { success: false, error: `payments: ${paymentError.message}`, invoices: 0, payments: 0 }
  }

  const { data: abandonedInvoices, error: invoiceError } = await supabase
    .from('xero_invoices')
    .update({ sync_status: 'abandoned', sync_error: ABANDONED_CART_REASON })
    .in('id', invoiceIds)
    .eq('sync_status', 'staged')
    .select('id')

  if (invoiceError) {
    return {
      success: false,
      error: `invoices: ${invoiceError.message}`,
      invoices: 0,
      payments: abandonedPayments?.length || 0,
    }
  }

  return {
    success: true,
    error: null,
    invoices: abandonedInvoices?.length || 0,
    payments: abandonedPayments?.length || 0,
  }
}

/**
 * Delete email_logs past the retention window.
 *
 * The delete is filtered by the same predicate as the count rather than by the
 * ids read back, so a row written between the two statements is simply picked
 * up on the next run instead of being missed.
 */
async function pruneOldEmailLogs(
  supabase: Supabase
): Promise<StepResult & { deleted: number }> {
  const cutoff = new Date(Date.now() - EMAIL_LOG_RETENTION_MS).toISOString()

  const { data, error } = await supabase
    .from('email_logs')
    .delete()
    .lt('created_at', cutoff)
    .select('id')

  if (error) {
    return { success: false, error: error.message, deleted: 0 }
  }

  return { success: true, error: null, deleted: data?.length || 0 }
}

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request, 'daily-housekeeping')
  if (denied) return denied

  const startTime = Date.now()
  const results = {
    registrationsExpired: 0,
    cartInvoicesAbandoned: 0,
    cartPaymentsAbandoned: 0,
    emailLogsDeleted: 0,
    errors: [] as string[],
  }

  try {
    logger.logBatchProcessing(
      'cron-housekeeping-start',
      '🕐 Scheduled daily housekeeping started',
      { timestamp: new Date().toISOString() }
    )

    const supabase = createAdminClient()

    // Each step is isolated: a thrown exception or returned error is recorded
    // and the remaining steps still run.
    try {
      const registrations = await expireAbandonedRegistrations(supabase)
      results.registrationsExpired = registrations.expired
      if (registrations.error) {
        results.errors.push(`Abandoned registration expiry error: ${registrations.error}`)
      }
    } catch (error) {
      results.errors.push(
        `Abandoned registration expiry error: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    try {
      const carts = await abandonStaleCarts(supabase)
      results.cartInvoicesAbandoned = carts.invoices
      results.cartPaymentsAbandoned = carts.payments
      if (carts.error) {
        results.errors.push(`Stale cart abandonment error: ${carts.error}`)
      }
    } catch (error) {
      results.errors.push(
        `Stale cart abandonment error: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    try {
      const emailLogs = await pruneOldEmailLogs(supabase)
      results.emailLogsDeleted = emailLogs.deleted
      if (emailLogs.error) {
        results.errors.push(`Email log prune error: ${emailLogs.error}`)
      }
    } catch (error) {
      results.errors.push(
        `Email log prune error: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    const duration = Date.now() - startTime
    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing(
      'cron-housekeeping-results',
      `Scheduled daily housekeeping completed in ${duration}ms`,
      {
        duration,
        registrationsExpired: results.registrationsExpired,
        cartInvoicesAbandoned: results.cartInvoicesAbandoned,
        cartPaymentsAbandoned: results.cartPaymentsAbandoned,
        emailLogsDeleted: results.emailLogsDeleted,
        errorCount: results.errors.length,
      },
      hasErrors ? 'warn' : 'info'
    )

    return NextResponse.json({
      success: !hasErrors,
      duration,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.logBatchProcessing(
      'cron-housekeeping-error',
      '❌ Scheduled daily housekeeping failed with exception',
      { duration, error: errorMessage },
      'error'
    )

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        duration,
        results,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
