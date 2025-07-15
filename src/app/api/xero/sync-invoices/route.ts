import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createXeroInvoiceForPayment, bulkSyncUnsyncedInvoices } from '@/lib/xero/invoices'

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
    const { tenant_id, payment_id, bulk_sync } = body

    if (!tenant_id) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    if (bulk_sync) {
      // Bulk sync all unsynced invoices
      const result = await bulkSyncUnsyncedInvoices(tenant_id)
      
      return NextResponse.json({
        success: result.success,
        message: result.success 
          ? `Bulk sync completed. ${result.synced} invoices synced, ${result.failed} failed.`
          : 'Bulk sync failed',
        synced: result.synced,
        failed: result.failed,
        errors: result.errors
      })

    } else if (payment_id) {
      // Sync specific payment as invoice
      const { data: paymentToSync, error: paymentError } = await supabase
        .from('payments')
        .select('id, status, stripe_payment_intent_id')
        .eq('id', payment_id)
        .single()

      if (paymentError || !paymentToSync) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      if (paymentToSync.status !== 'completed') {
        return NextResponse.json({ 
          error: 'Payment must be completed before syncing to Xero' 
        }, { status: 400 })
      }

      const result = await createXeroInvoiceForPayment(payment_id, tenant_id)
      
      return NextResponse.json({
        success: result.success,
        message: result.success 
          ? `Invoice created successfully: ${result.invoiceNumber}`
          : `Failed to create invoice: ${result.error}`,
        xero_invoice_id: result.xeroInvoiceId,
        invoice_number: result.invoiceNumber,
        error: result.error
      })

    } else {
      return NextResponse.json({ 
        error: 'Either payment_id or bulk_sync must be specified' 
      }, { status: 400 })
    }

  } catch (error) {
    console.error('Error in invoice sync API:', error)
    return NextResponse.json({ 
      error: 'Failed to sync invoices' 
    }, { status: 500 })
  }
}