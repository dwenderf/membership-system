import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync-xero'
import { logSyncEvent } from '@/lib/system-events'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check if user is authenticated and is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userDataError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Trigger manual sync
    console.log('🔄 Manual Xero sync triggered by admin:', user.email)
    
    const startTime = new Date()
    const results = await xeroBatchSyncManager.syncAllPendingRecords()
    
    // Log system event
    const initiator = `manual (${user.email})`
    await logSyncEvent(
      'xero_sync',
      initiator,
      startTime,
      {
        processed: results.invoices.synced + results.invoices.failed + results.payments.synced + results.payments.failed,
        successful: results.invoices.synced + results.payments.synced,
        failed: results.invoices.failed + results.payments.failed
      }
    )
    
    // Check for connection failures
    if (results.connectionStatus === 'failed') {
      console.log('❌ Manual Xero sync failed: Connection authentication failed')
      return NextResponse.json({
        success: false,
        error: 'Connection failed',
        message: 'Xero connection authentication failed during validation. This sometimes happens when tokens become corrupted. If this continues, try disconnecting and reconnecting your Xero integration.',
        connectionStatus: results.connectionStatus,
        suggestion: 'Go to Settings → Integrations to reset the connection if needed'
      }, { status: 403 })
    }

    if (results.connectionStatus === 'no_tenant') {
      console.log('❌ Manual Xero sync failed: No Xero tenant connected')
      return NextResponse.json({
        success: false,
        error: 'No connection',
        message: 'No Xero organization is connected. Please set up your Xero integration.',
        connectionStatus: results.connectionStatus,
        suggestion: 'Go to Settings → Integrations and connect Xero'
      }, { status: 400 })
    }

    console.log('✅ Manual Xero sync completed:', {
      invoices: `${results.invoices.synced} synced, ${results.invoices.failed} failed`,
      payments: `${results.payments.synced} synced, ${results.payments.failed} failed`,
      connectionStatus: results.connectionStatus
    })

    return NextResponse.json({
      success: true,
      message: 'Manual sync completed',
      connectionStatus: results.connectionStatus,
      results: {
        invoices: {
          synced: results.invoices.synced,
          failed: results.invoices.failed,
          total_processed: results.invoices.synced + results.invoices.failed
        },
        payments: {
          synced: results.payments.synced,
          failed: results.payments.failed,
          total_processed: results.payments.synced + results.payments.failed
        },
        total_synced: results.invoices.synced + results.payments.synced,
        total_failed: results.invoices.failed + results.payments.failed
      }
    })

  } catch (error) {
    console.error('❌ Manual Xero sync failed:', error)
    
    // Log failed system event if we have user info
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const initiator = `manual (${user.email})`
        await logSyncEvent(
          'xero_sync',
          initiator,
          new Date(),
          { processed: 0, successful: 0, failed: 0 },
          error instanceof Error ? error.message : String(error)
        )
      }
    } catch (logError) {
      console.error('Failed to log system event:', logError)
    }
    
    return NextResponse.json({ 
      error: 'Failed to trigger manual sync',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}