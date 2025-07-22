import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync'

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
    
    const results = await xeroBatchSyncManager.syncAllPendingRecords()
    
    console.log('✅ Manual Xero sync completed:', {
      invoices: `${results.invoices.synced} synced, ${results.invoices.failed} failed`,
      payments: `${results.payments.synced} synced, ${results.payments.failed} failed`
    })

    return NextResponse.json({
      success: true,
      message: 'Manual sync completed',
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
    return NextResponse.json({ 
      error: 'Failed to trigger manual sync',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}