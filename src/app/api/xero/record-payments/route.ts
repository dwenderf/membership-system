import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recordStripePaymentInXero, bulkRecordUnsyncedPayments } from '@/lib/xero/payments'

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
    const { tenant_id, payment_id, bulk_sync, bank_account_code } = body

    if (!tenant_id) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    const bankAccountCode = bank_account_code || 'STRIPE'

    if (bulk_sync) {
      // Bulk record all unsynced payments
      const result = await bulkRecordUnsyncedPayments(tenant_id, bankAccountCode)
      
      return NextResponse.json({
        success: result.success,
        message: result.success 
          ? `Bulk payment recording completed. ${result.recorded} payments recorded, ${result.failed} failed.`
          : 'Bulk payment recording failed',
        recorded: result.recorded,
        failed: result.failed,
        errors: result.errors
      })

    } else if (payment_id) {
      // Record specific payment
      const { data: paymentToRecord, error: paymentError } = await supabase
        .from('payments')
        .select('id, status, stripe_payment_intent_id')
        .eq('id', payment_id)
        .single()

      if (paymentError || !paymentToRecord) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      if (paymentToRecord.status !== 'completed') {
        return NextResponse.json({ 
          error: 'Payment must be completed before recording in Xero' 
        }, { status: 400 })
      }

      // Check if invoice exists for this payment
      const { data: existingInvoice, error: invoiceError } = await supabase
        .from('xero_invoices')
        .select('invoice_number')
        .eq('payment_id', payment_id)
        .eq('tenant_id', tenant_id)
        .eq('sync_status', 'synced')
        .single()

      if (invoiceError || !existingInvoice) {
        return NextResponse.json({ 
          error: 'Invoice must be created in Xero before recording payment' 
        }, { status: 400 })
      }

      const result = await recordStripePaymentInXero(payment_id, tenant_id, bankAccountCode)
      
      return NextResponse.json({
        success: result.success,
        message: result.success 
          ? `Payment recorded successfully for invoice ${existingInvoice.invoice_number}`
          : `Failed to record payment: ${result.error}`,
        xero_payment_id: result.xeroPaymentId,
        error: result.error
      })

    } else {
      return NextResponse.json({ 
        error: 'Either payment_id or bulk_sync must be specified' 
      }, { status: 400 })
    }

  } catch (error) {
    console.error('Error in payment recording API:', error)
    return NextResponse.json({ 
      error: 'Failed to record payments' 
    }, { status: 500 })
  }
}