import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/xero/client'
import { XeroBatchSyncManager } from '@/lib/xero/batch-sync'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const results = {
    keepAlive: { success: false, error: null as string | null },
    sync: { success: false, error: null as string | null }
  }

  try {
    logger.logPaymentProcessing(
      'cron-xero-daily-start',
      'Starting daily Xero cron job',
      { timestamp: new Date().toISOString() },
      'info'
    )

    // Step 1: Xero Keep-Alive
    try {
      logger.logPaymentProcessing(
        'cron-keep-alive-start',
        'Starting Xero keep-alive process',
        {},
        'info'
      )

      // For keep-alive, we'll use a simple connection test
      const activeTenant = await getActiveTenant()
      const keepAliveResult = activeTenant ? { success: true, tenants: [activeTenant] } : { success: false, error: 'No active tenant' }
      
      if (keepAliveResult.success) {
        results.keepAlive.success = true
        logger.logPaymentProcessing(
          'cron-keep-alive-success',
          'Xero keep-alive completed successfully',
          { tenantCount: keepAliveResult.tenants?.length || 0 },
          'info'
        )
      } else {
        results.keepAlive.error = keepAliveResult.error || 'Unknown keep-alive error'
        logger.logPaymentProcessing(
          'cron-keep-alive-failed',
          'Xero keep-alive failed',
          { error: results.keepAlive.error },
          'error'
        )
      }
    } catch (error) {
      results.keepAlive.error = error instanceof Error ? error.message : String(error)
      logger.logPaymentProcessing(
        'cron-keep-alive-error',
        'Xero keep-alive threw exception',
        { error: results.keepAlive.error },
        'error'
      )
    }

    // Step 2: Xero Sync
    try {
      logger.logPaymentProcessing(
        'cron-sync-start',
        'Starting Xero sync process',
        {},
        'info'
      )

      const batchSyncManager = new XeroBatchSyncManager()
      const syncResult = await batchSyncManager.syncAllPendingRecords()
      
      // The sync method doesn't throw, so we consider it successful if it completes
      results.sync.success = true
      logger.logPaymentProcessing(
        'cron-sync-success',
        'Xero sync completed successfully',
        { 
          invoicesSynced: syncResult.invoices.synced,
          invoicesFailed: syncResult.invoices.failed,
          paymentsSynced: syncResult.payments.synced,
          paymentsFailed: syncResult.payments.failed
        },
        'info'
      )
    } catch (error) {
      results.sync.error = error instanceof Error ? error.message : String(error)
      logger.logPaymentProcessing(
        'cron-sync-error',
        'Xero sync threw exception',
        { error: results.sync.error },
        'error'
      )
    }

    const duration = Date.now() - startTime
    const overallSuccess = results.keepAlive.success && results.sync.success

    logger.logPaymentProcessing(
      'cron-xero-daily-complete',
      `Daily Xero cron job completed in ${duration}ms`,
      { 
        duration,
        overallSuccess,
        results
      },
      overallSuccess ? 'info' : 'warn'
    )

    return NextResponse.json({
      success: overallSuccess,
      duration,
      results,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    logger.logPaymentProcessing(
      'cron-xero-daily-error',
      'Daily Xero cron job failed with exception',
      { 
        duration,
        error: errorMessage
      },
      'error'
    )

    return NextResponse.json({
      success: false,
      error: errorMessage,
      duration,
      results,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
} 