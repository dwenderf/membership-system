import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * Daily housekeeping — replaces the former /api/cron/cleanup and
 * /api/cron/maintenance routes, which split this work between two ambiguously
 * named endpoints (only one of which was ever declared in vercel.json).
 *
 * Runs two independent sweeps, each reporting its own counters and errors so
 * one failing step never masks another:
 *
 *  1. expireAbandonedRegistrations — awaiting_payment rows the user never paid
 *  2. pruneOldEmailLogs            — email_logs past the 90-day retention window
 *
 * The predecessor also swept xero_invoices/xero_payments, filtering
 * sync_status = 'pending' and marking matches 'abandoned' after 24 hours. That
 * step is deliberately NOT carried over: 'pending' is the live Xero sync queue
 * (drained by get_pending_xero_invoices_with_lock every 5 minutes via
 * /api/cron/xero-sync), not the pre-payment cart state, which is 'staged'. The
 * sweep only ever appeared safe because the anon client could not write; under
 * the service-role client it would drop real accounting records — refund credit
 * notes and manually retried failures both enter the queue as 'pending' — out
 * of the sync queue precisely when a sync is stuck and needs attention. An
 * abandoned-cart sweep keyed on 'staged' + payment_id IS NULL may still be
 * wanted; it needs its own decision on semantics and threshold.
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
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const results = {
    registrationsExpired: 0,
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
