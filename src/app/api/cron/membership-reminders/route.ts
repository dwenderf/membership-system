import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { sendExpirationReminders } from '@/lib/services/membership-reminder-processor'

/**
 * Cron Job: Daily Membership Expiration Reminders
 * Runs daily at 2:09 AM (staggered after payment-plans)
 *
 * Sends a reminder email to any member whose membership expires in exactly
 * 30, 14, 7, or 1 days (see MEMBERSHIP_REMINDER_THRESHOLDS_DAYS).
 *
 * Vercel Cron configuration in vercel.json:
 * {
 *   "path": "/api/cron/membership-reminders",
 *   "schedule": "9 2 * * *"
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify this is a cron request from Vercel. Fail closed: a missing
    // secret must never mean "no authentication required".
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      logger.logBatchProcessing(
        'cron-membership-reminders-not-configured',
        'CRON_SECRET is not configured',
        {},
        'error'
      )
      return NextResponse.json({ error: 'Not configured' }, { status: 503 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.logBatchProcessing(
        'cron-membership-reminders-unauthorized',
        'Unauthorized cron job attempt',
        {},
        'warn'
      )
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    logger.logBatchProcessing(
      'cron-membership-reminders-start',
      'Starting scheduled membership reminder processing'
    )

    const today = new Date().toISOString().split('T')[0]
    const results = await sendExpirationReminders(today)

    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing(
      'cron-membership-reminders-complete',
      'Membership reminder processing completed',
      {
        remindersSent: results.remindersSent,
        errorCount: results.errors.length
      },
      hasErrors ? 'warn' : 'info'
    )

    return NextResponse.json({
      success: true,
      message: 'Membership reminder processing completed',
      results
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logBatchProcessing(
      'cron-membership-reminders-error',
      'Error during membership reminder processing',
      { error: errorMessage },
      'error'
    )

    return NextResponse.json(
      {
        success: false,
        error: errorMessage
      },
      { status: 500 }
    )
  }
}
