import { NextRequest, NextResponse } from 'next/server'
import { syncXeroAccounts } from '@/lib/xero/accounts-sync'
import { logger } from '@/lib/logging/logger'

/**
 * Cron Job: Daily Xero Chart of Accounts Sync
 * Runs daily at 2:00 AM
 *
 * Vercel Cron configuration in vercel.json:
 * {
 *   "path": "/api/cron/sync-xero-accounts",
 *   "schedule": "0 2 * * *"
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify this is a cron request from Vercel
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logger.logAdminAction(
        'cron-sync-xero-accounts-unauthorized',
        'Unauthorized cron job attempt',
        { authHeader },
        'warn'
      )
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    logger.logAdminAction(
      'cron-sync-xero-accounts-start',
      'Starting scheduled Xero accounts sync'
    )

    // Perform sync
    const result = await syncXeroAccounts()

    if (!result.success) {
      logger.logAdminAction(
        'cron-sync-xero-accounts-failed',
        'Scheduled Xero accounts sync failed',
        { error: result.error },
        'error'
      )

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Sync failed'
        },
        { status: 500 }
      )
    }

    logger.logAdminAction(
      'cron-sync-xero-accounts-complete',
      'Scheduled Xero accounts sync completed successfully',
      {
        totalAccounts: result.totalAccounts,
        added: result.added,
        updated: result.updated,
        removed: result.removed
      }
    )

    return NextResponse.json(result)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logAdminAction(
      'cron-sync-xero-accounts-error',
      'Error during scheduled Xero accounts sync',
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
