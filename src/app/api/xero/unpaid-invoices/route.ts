import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all payments for the user
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('id, status, created_at, completed_at')
      .eq('user_id', user.id)

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError)
      return NextResponse.json({ hasUnpaid: false, count: 0, totalAmount: 0 })
    }

    const paymentIds = payments?.map(p => p.id) || []
    
    if (paymentIds.length === 0) {
      return NextResponse.json({ hasUnpaid: false, count: 0, totalAmount: 0 })
    }

    // Then get invoices for those payments
    const { data: invoices, error: invoicesError } = await supabase
      .from('xero_invoices')
      .select(`
        id,
        invoice_number,
        xero_invoice_id,
        total_amount,
        net_amount,
        invoice_status,
        created_at,
        last_synced_at,
        payment_id
      `)
      .in('payment_id', paymentIds)
      .not('xero_invoice_id', 'is', null) // Only invoices that have been synced to Xero
      .neq('invoice_status', 'PAID') // Not paid in Xero
      .order('created_at', { ascending: false })

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError)
      return NextResponse.json({ hasUnpaid: false, count: 0, totalAmount: 0 })
    }

    // Combine the data
    const invoicesWithPayments = invoices?.map(invoice => {
      const payment = payments?.find(p => p.id === invoice.payment_id)
      return {
        ...invoice,
        payment: payment || null
      }
    }) || []

    const unpaidInvoices = invoicesWithPayments.filter(invoice => {
      // Filter out invoices where the payment is completed (paid via Stripe)
      return !invoice.payment?.completed_at
    })

    const totalAmount = unpaidInvoices.reduce((sum, invoice) => sum + invoice.net_amount, 0)

    return NextResponse.json({
      hasUnpaid: unpaidInvoices.length > 0,
      count: unpaidInvoices.length,
      totalAmount
    })

  } catch (error) {
    console.error('Error checking unpaid invoices:', error)
    return NextResponse.json({ hasUnpaid: false, count: 0, totalAmount: 0 })
  }
} 