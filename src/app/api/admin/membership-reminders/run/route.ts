import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { sendExpirationReminders } from '@/lib/services/membership-reminder-processor'

/**
 * Manual Membership Reminder Trigger
 *
 * Allows admins to manually trigger membership expiration reminder
 * processing without waiting for the daily cron job.
 *
 * POST /api/admin/membership-reminders/run
 *
 * Authorization: Requires authenticated admin user
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    logger.logBatchProcessing(
      'manual-membership-reminders-start',
      'Starting manual membership reminder processing',
      { userId: authUser.id }
    )

    const today = new Date().toISOString().split('T')[0]

    // Uses the same shared processor as the cron job, so manual runs and
    // the daily cron behave identically.
    const results = await sendExpirationReminders(today)

    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing(
      'manual-membership-reminders-complete',
      'Manual membership reminder processing completed',
      {
        remindersSent: results.remindersSent,
        errorCount: results.errors.length
      },
      hasErrors ? 'warn' : 'info'
    )

    return NextResponse.json({
      success: true,
      message: results.remindersSent === 0
        ? 'No memberships expiring on a reminder threshold today'
        : 'Manual membership reminder processing completed',
      results
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logBatchProcessing(
      'manual-membership-reminders-error',
      'Error during manual membership reminder processing',
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
