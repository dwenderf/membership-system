import { NextRequest, NextResponse } from 'next/server'
import { syncXeroAccounts } from '@/lib/xero/accounts-sync'
import { logger } from '@/lib/logging/logger'
import { authorizeCronRequest } from '@/lib/cron/auth'

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
    const denied = authorizeCronRequest(request, 'sync-xero-accounts')
    if (denied) return denied

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
