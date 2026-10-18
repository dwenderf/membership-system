import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { authorizeCronRequest } from '@/lib/cron/auth'
import { abandonCartsBeforePayment, abandonCartsWithPayment } from '@/lib/cron/abandon-carts'

/**
 * Daily housekeeping — replaces the former /api/cron/cleanup and
 * /api/cron/maintenance routes, which split this work between two ambiguously
 * named endpoints (only one of which was ever declared in vercel.json).
 *
 * Runs three independent sweeps, each reporting its own counters and errors so
 * one failing step never masks another:
 *
 *  1. expireAbandonedRegistrations — awaiting_payment rows the user never paid
 *  2. abandonStaleCarts            — staged Xero rows for carts never paid for (src/lib/cron/abandon-carts.ts)
 *  3. pruneOldEmailLogs            — email_logs past the 90-day retention window
 *
 * NOTE on the cart sweep: see src/lib/cron/abandon-carts.ts. It targets the pre-payment
 * cart state ('staged') and NEVER the 'pending' state, which is the live Xero sync queue.
 *
 * Uses the service-role client deliberately. Every table touched here has RLS
 * enabled with policies keyed on auth.uid(), and a cron request carries no
 * session — under the anon client each statement silently matches zero rows
 * rather than erroring, which is how the predecessor route appeared to succeed
 * nightly while doing nothing.
 */

const ABANDONED_REGISTRATION_AGE_MS = 60 * 60 * 1000 // 1 hour
const EMAIL_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

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
 * Mark Xero staging rows for never-completed carts as abandoned, in two branches (before the
 * Stripe step, and at/after it with a payment that provably never succeeded). Each reports its
 * own counters; one failing never hides the other. See src/lib/cron/abandon-carts.ts.
 */
async function abandonStaleCarts(supabase: Supabase) {
  const [beforePayment, withPayment] = await Promise.all([
    abandonCartsBeforePayment(supabase).catch(toFailedSweep),
    abandonCartsWithPayment(supabase).catch(e => ({ ...toFailedSweep(e), needsReconciliation: 0, abandonedOnSettledPayment: 0, abandonedPendingPayment: 0 })),
  ])
  return { beforePayment, withPayment }
}

function toFailedSweep(error: unknown) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    invoices: 0,
    payments: 0,
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
    cartInvoicesAbandonedBeforePayment: 0,
    cartInvoicesAbandonedWithPayment: 0,
    cartsNeedingReconciliation: 0,
    cartInvoicesAbandonedOnSettledPayment: 0,
    cartInvoicesAbandonedPendingPayment: 0,
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
      const { beforePayment, withPayment } = await abandonStaleCarts(supabase)
      results.cartInvoicesAbandonedBeforePayment = beforePayment.invoices
      results.cartInvoicesAbandonedWithPayment = withPayment.invoices
      results.cartInvoicesAbandoned = beforePayment.invoices + withPayment.invoices
      results.cartPaymentsAbandoned = beforePayment.payments + withPayment.payments
      results.cartsNeedingReconciliation = withPayment.needsReconciliation
      results.cartInvoicesAbandonedOnSettledPayment = withPayment.abandonedOnSettledPayment
      results.cartInvoicesAbandonedPendingPayment = withPayment.abandonedPendingPayment
      if (beforePayment.error) {
        results.errors.push(`Stale cart abandonment error: ${beforePayment.error}`)
      }
      if (withPayment.error) {
        results.errors.push(`Stale cart (with payment) abandonment error: ${withPayment.error}`)
      }
      if (withPayment.needsReconciliation > 0) {
        // Not an error: these are never touched by the sweep, but someone should look.
        logger.logBatchProcessing(
          'cron-housekeeping-carts-need-reconciliation',
          `${withPayment.needsReconciliation} staged invoice(s) belong to a completed payment that promoted invoices do not fully cover; they need manual reconciliation`,
          { count: withPayment.needsReconciliation },
          'warn'
        )
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
        cartInvoicesAbandonedBeforePayment: results.cartInvoicesAbandonedBeforePayment,
        cartInvoicesAbandonedWithPayment: results.cartInvoicesAbandonedWithPayment,
        cartsNeedingReconciliation: results.cartsNeedingReconciliation,
        cartInvoicesAbandonedOnSettledPayment: results.cartInvoicesAbandonedOnSettledPayment,
        cartInvoicesAbandonedPendingPayment: results.cartInvoicesAbandonedPendingPayment,
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
