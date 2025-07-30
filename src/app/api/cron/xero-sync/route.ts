import { NextRequest, NextResponse } from 'next/server'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync-xero'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.logXeroSync('cron-sync-start', '🕐 Scheduled Xero sync started (every 5 minutes)')

    // Check if there are any pending records to sync using centralized function
    const pendingCount = await xeroBatchSyncManager.getPendingXeroCount()
    
    if (pendingCount === 0) {
      logger.logXeroSync('cron-sync-skip', 'No pending Xero records to sync', { pendingCount: 0 })
      
      // Log system event even when no items to sync
      const { logSyncEvent } = await import('@/lib/system-events')
      await logSyncEvent(
        'xero_sync',
        'cron_job',
        new Date(),
        { processed: 0, successful: 0, failed: 0 }
      )
      
      return NextResponse.json({
        success: true,
        message: 'No pending records to sync',
        pendingCount: 0
      })
    }

    logger.logXeroSync('cron-sync-processing', `Processing Xero sync: ${pendingCount} pending records to sync`, { pendingCount })

    const startTime = new Date()
    
    // Run the batch sync with Pro plan optimizations
    const results = await xeroBatchSyncManager.syncAllPendingRecords()
    
    // Log system event
    const { logSyncEvent } = await import('@/lib/system-events')
    await logSyncEvent(
      'xero_sync',
      'cron_job',
      startTime,
      {
        processed: results.invoices.synced + results.invoices.failed + results.payments.synced + results.payments.failed,
        successful: results.invoices.synced + results.payments.synced,
        failed: results.invoices.failed + results.payments.failed
      }
    )
    
    logger.logXeroSync('cron-sync-results', 'Scheduled Xero sync completed', {
      invoices: { synced: results.invoices.synced, failed: results.invoices.failed },
      payments: { synced: results.payments.synced, failed: results.payments.failed },
      totalSynced: results.invoices.synced + results.payments.synced,
      totalFailed: results.invoices.failed + results.payments.failed
    })

    return NextResponse.json({
      success: true,
      message: 'Xero sync completed',
      results,
      pendingCount,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    logger.logXeroSync('cron-sync-error', 'Scheduled Xero sync failed', { 
      error: errorMessage
    }, 'error')

    return NextResponse.json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

 