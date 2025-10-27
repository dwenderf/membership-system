import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncXeroAccounts } from '@/lib/xero/accounts-sync'
import { logger } from '@/lib/logging/logger'

/**
 * Manual Xero Chart of Accounts Sync
 * POST /api/admin/sync-xero-accounts
 *
 * Triggers immediate sync of Xero chart of accounts to local database
 * Requires admin authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is admin
    const { data: userRecord } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userRecord?.is_admin) {
      logger.logAdminAction(
        'sync-xero-accounts-unauthorized',
        'Non-admin user attempted to sync Xero accounts',
        { userId: user.id },
        'warn'
      )

      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      )
    }

    logger.logAdminAction(
      'sync-xero-accounts-start',
      'Admin initiated manual Xero accounts sync',
      { userId: user.id }
    )

    // Perform sync
    const result = await syncXeroAccounts()

    if (!result.success) {
      logger.logAdminAction(
        'sync-xero-accounts-failed',
        'Manual Xero accounts sync failed',
        { userId: user.id, error: result.error },
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
      'sync-xero-accounts-complete',
      'Manual Xero accounts sync completed successfully',
      {
        userId: user.id,
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
      'sync-xero-accounts-error',
      'Error during manual Xero accounts sync',
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
