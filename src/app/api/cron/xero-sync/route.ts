import { NextRequest, NextResponse } from 'next/server'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.logXeroSync('cron-sync-start', '🕐 Scheduled Xero sync started')

    // Check if there are any pending records to sync
    const pendingCount = await getPendingXeroCount()
    
    if (pendingCount === 0) {
      logger.logXeroSync('cron-sync-skip', 'No pending Xero records to sync', { pendingCount: 0 })
      return NextResponse.json({
        success: true,
        message: 'No pending records to sync',
        pendingCount: 0
      })
    }

    logger.logXeroSync('cron-sync-processing', `Processing Xero sync: ${pendingCount} pending records to sync`, { pendingCount })

    // Run the batch sync
    const results = await xeroBatchSyncManager.syncAllPendingRecords()
    
    logger.logXeroSync('cron-sync-results', 'Scheduled Xero sync completed', {
      invoices: { synced: results.invoices.synced, failed: results.invoices.failed },
      payments: { synced: results.payments.synced, failed: results.payments.failed },
      totalSynced: results.invoices.synced + results.payments.synced,
      totalFailed: results.invoices.failed + results.payments.failed
    })

    return NextResponse.json({
      success: true,
      message: 'Xero sync completed successfully',
      results: {
        invoices: { synced: results.invoices.synced, failed: results.invoices.failed },
        payments: { synced: results.payments.synced, failed: results.payments.failed },
        totalSynced: results.invoices.synced + results.payments.synced,
        totalFailed: results.invoices.failed + results.payments.failed
      }
    })

  } catch (error) {
    logger.logXeroSync('cron-sync-error', '❌ Scheduled Xero sync error', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'error')
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

/**
 * Get count of pending Xero records
 */
async function getPendingXeroCount(): Promise<number> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  
  // Count pending invoices
  const { count: pendingInvoices } = await supabase
    .from('xero_invoices')
    .select('*', { count: 'exact', head: true })
    .in('sync_status', ['pending', 'staged'])

  // Count pending payments
  const { count: pendingPayments } = await supabase
    .from('xero_payments')
    .select('*', { count: 'exact', head: true })
    .eq('sync_status', 'pending')

  return (pendingInvoices || 0) + (pendingPayments || 0)
} 