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

    const body = await request.json()
    const { type, items } = body // type: 'all' | 'selected', items: array of IDs for selected

    console.log('🔄 Retry failed sync triggered by admin:', user.email, { type, itemCount: items?.length || 'all' })

    let retryResults = { invoices: 0, payments: 0, errors: [] as string[] }

    if (type === 'all') {
      // Reset all failed items to pending and trigger sync
      console.log('🔄 Resetting all failed items to pending...')
      
      // Reset failed invoices to pending
      const { data: resetInvoices, error: invoiceError } = await supabase
        .from('xero_invoices')
        .update({ 
          sync_status: 'pending',
          sync_error: null,
          retry_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('sync_status', 'failed')
        .select('id')

      // Reset failed payments to pending  
      const { data: resetPayments, error: paymentError } = await supabase
        .from('xero_payments')
        .update({ 
          sync_status: 'pending',
          sync_error: null,
          retry_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('sync_status', 'failed')
        .select('id')

      if (invoiceError) retryResults.errors.push(`Invoice reset error: ${invoiceError.message}`)
      if (paymentError) retryResults.errors.push(`Payment reset error: ${paymentError.message}`)

      retryResults.invoices = resetInvoices?.length || 0
      retryResults.payments = resetPayments?.length || 0

    } else if (type === 'selected' && items?.length > 0) {
      // Reset selected items to pending
      console.log('🔄 Resetting selected items to pending...', items)
      
      const invoiceIds = items.filter((id: string) => id.startsWith('inv_'))
      const paymentIds = items.filter((id: string) => id.startsWith('pay_'))

      if (invoiceIds.length > 0) {
        const { data: resetInvoices, error: invoiceError } = await supabase
          .from('xero_invoices')
          .update({ 
            sync_status: 'pending',
            sync_error: null,
            retry_count: 0,
            updated_at: new Date().toISOString()
          })
          .in('id', invoiceIds.map((id: string) => id.replace('inv_', '')))
          .select('id')

        if (invoiceError) retryResults.errors.push(`Invoice reset error: ${invoiceError.message}`)
        else retryResults.invoices = resetInvoices?.length || 0
      }

      if (paymentIds.length > 0) {
        const { data: resetPayments, error: paymentError } = await supabase
          .from('xero_payments')
          .update({ 
            sync_status: 'pending',
            sync_error: null,
            retry_count: 0,
            updated_at: new Date().toISOString()
          })
          .in('id', paymentIds.map((id: string) => id.replace('pay_', '')))
          .select('id')

        if (paymentError) retryResults.errors.push(`Payment reset error: ${paymentError.message}`)
        else retryResults.payments = resetPayments?.length || 0
      }
    }

    // Trigger immediate sync
    console.log('🔄 Triggering immediate sync after retry reset...')
    const syncResults = await xeroBatchSyncManager.syncAllPendingRecords()

    console.log('✅ Retry failed sync completed:', {
      reset: retryResults,
      sync: syncResults
    })

    return NextResponse.json({
      success: true,
      message: 'Retry completed',
      reset_results: retryResults,
      sync_results: {
        invoices: syncResults.invoices,
        payments: syncResults.payments,
        total_synced: syncResults.invoices.synced + syncResults.payments.synced,
        total_failed: syncResults.invoices.failed + syncResults.payments.failed
      }
    })

  } catch (error) {
    console.error('❌ Retry failed sync error:', error)
    return NextResponse.json({ 
      error: 'Failed to retry sync',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}