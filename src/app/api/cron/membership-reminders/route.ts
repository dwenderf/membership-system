import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { sendExpirationReminders } from '@/lib/services/membership-reminder-processor'
import { authorizeCronRequest } from '@/lib/cron/auth'

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
    const denied = authorizeCronRequest(request, 'membership-reminders')
    if (denied) return denied

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
