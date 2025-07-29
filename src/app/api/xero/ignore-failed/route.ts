import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    console.log('🚫 Ignore failed sync triggered by admin:', user.email, { type, itemCount: items?.length || 'all' })

    let ignoreResults = { invoices: 0, payments: 0, errors: [] as string[] }

    if (type === 'all') {
      // Mark all failed items as ignored
      console.log('🚫 Marking all failed items as ignored...')
      
      // Mark failed invoices as ignored
      const { data: ignoredInvoices, error: invoiceError } = await supabase
        .from('xero_invoices')
        .update({ 
          sync_status: 'ignore',
          updated_at: new Date().toISOString()
        })
        .eq('sync_status', 'failed')
        .select('id')

      // Mark failed payments as ignored  
      const { data: ignoredPayments, error: paymentError } = await supabase
        .from('xero_payments')
        .update({ 
          sync_status: 'ignore',
          updated_at: new Date().toISOString()
        })
        .eq('sync_status', 'failed')
        .select('id')

      if (invoiceError) ignoreResults.errors.push(`Invoice ignore error: ${invoiceError.message}`)
      if (paymentError) ignoreResults.errors.push(`Payment ignore error: ${paymentError.message}`)

      ignoreResults.invoices = ignoredInvoices?.length || 0
      ignoreResults.payments = ignoredPayments?.length || 0

    } else if (type === 'selected' && items?.length > 0) {
      // Mark selected items as ignored
      console.log('🚫 Marking selected items as ignored...', items)
      
      const invoiceIds = items.filter((id: string) => id.startsWith('inv_'))
      const paymentIds = items.filter((id: string) => id.startsWith('pay_'))

      if (invoiceIds.length > 0) {
        const { data: ignoredInvoices, error: invoiceError } = await supabase
          .from('xero_invoices')
          .update({ 
            sync_status: 'ignore',
            updated_at: new Date().toISOString()
          })
          .in('id', invoiceIds.map((id: string) => id.replace('inv_', '')))
          .select('id')

        if (invoiceError) ignoreResults.errors.push(`Invoice ignore error: ${invoiceError.message}`)
        else ignoreResults.invoices = ignoredInvoices?.length || 0
      }

      if (paymentIds.length > 0) {
        const { data: ignoredPayments, error: paymentError } = await supabase
          .from('xero_payments')
          .update({ 
            sync_status: 'ignore',
            updated_at: new Date().toISOString()
          })
          .in('id', paymentIds.map((id: string) => id.replace('pay_', '')))
          .select('id')

        if (paymentError) ignoreResults.errors.push(`Payment ignore error: ${paymentError.message}`)
        else ignoreResults.payments = ignoredPayments?.length || 0
      }
    }

    console.log('✅ Ignore failed sync completed:', ignoreResults)

    return NextResponse.json({
      success: true,
      message: 'Items marked as ignored',
      ignore_results: ignoreResults
    })

  } catch (error) {
    console.error('❌ Ignore failed sync error:', error)
    return NextResponse.json({ 
      error: 'Failed to ignore items',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
} 