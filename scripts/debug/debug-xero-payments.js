const { createClient } = require('@supabase/supabase-js')
require(dotenv').config({ path:.env.local' })

async function debugXeroPayments() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log(🔍 Debugging Xero Payment Records...\n')

  // Check pending invoices
  console.log('📄 Pending Invoices:)
  const { data: pendingInvoices, error: invoiceError } = await supabase
    .from('xero_invoices')
    .select(`
      id,
      payment_id,
      tenant_id,
      xero_invoice_id,
      invoice_number,
      invoice_status,
      net_amount,
      sync_status,
      staged_at,
      last_synced_at,
      sync_error,
      payments (
        id,
        status,
        final_amount,
        completed_at,
        users!payments_user_id_fkey (
          first_name,
          last_name,
          member_id
        )
      )
    `)
    .in('sync_status, [pending', 'staged])    .order('staged_at', { ascending: true })

  if (invoiceError) {
    console.error('❌ Error fetching pending invoices:', invoiceError)
  } else {
    console.log(`Found ${pendingInvoices?.length || 0} pending invoices:`)
    pendingInvoices?.forEach(invoice => {
      const payment = Array.isArray(invoice.payments) ? invoice.payments[0] : invoice.payments
      console.log(`  - Invoice ${invoice.id}: ${invoice.invoice_number || 'No number'} (${invoice.sync_status})`)
      console.log(`    Payment: ${payment ? `${payment.status} - $${payment.final_amount/100}` : 'No payment'}`)
      console.log(`    User: ${payment?.users ? `${payment.users.first_name} ${payment.users.last_name}` : 'Unknown'}`)
      console.log(`    Amount: $${invoice.net_amount/100}, Status: ${invoice.invoice_status}`)
      if (invoice.sync_error) console.log(`    Error: ${invoice.sync_error}`)
      console.log('')
    })
  }

  // Check pending payments
  console.log('💰 Pending Payments:)
  const { data: pendingPayments, error: paymentError } = await supabase
    .from('xero_payments')
    .select(`
      id,
      xero_invoice_id,
      tenant_id,
      xero_payment_id,
      payment_method,
      amount_paid,
      sync_status,
      staged_at,
      last_synced_at,
      sync_error,
      xero_invoices (
        payment_id,
        invoice_number,
        payments (
          users!payments_user_id_fkey (
            first_name,
            last_name,
            member_id
          )
        )
      )
    `)
    .in('sync_status, [pending', 'staged])    .order('staged_at', { ascending: true })

  if (paymentError) {
    console.error('❌ Error fetching pending payments:', paymentError)
  } else {
    console.log(`Found ${pendingPayments?.length || 0} pending payments:`)
    pendingPayments?.forEach(payment => {
      const invoice = Array.isArray(payment.xero_invoices) ? payment.xero_invoices[0] : payment.xero_invoices
      const userPayment = invoice?.payments ? (Array.isArray(invoice.payments) ? invoice.payments[0] : invoice.payments) : null
      console.log(`  - Payment ${payment.id}: $${payment.amount_paid/100} (${payment.sync_status})`)
      console.log(`    Invoice: ${invoice ? invoice.invoice_number || 'No number'}`)
      console.log(`    User: ${userPayment?.users ? `${userPayment.users.first_name} ${userPayment.users.last_name}` : 'Unknown'}`)
      console.log(`    Method: ${payment.payment_method}, Amount: $${payment.amount_paid/100}`)
      if (payment.sync_error) console.log(`    Error: ${payment.sync_error}`)
      console.log('')
    })
  }

  // Check completed payments that might need syncing
  console.log('✅ Completed Payments (potential candidates for syncing):)
  const { data: completedPayments, error: completedError } = await supabase
    .from('payments')
    .select(`
      id,
      status,
      final_amount,
      completed_at,
      xero_synced,
      xero_sync_error,
      users!payments_user_id_fkey (
        first_name,
        last_name,
        member_id
      )
    `)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(10)

  if (completedError) {
    console.error('❌ Error fetching completed payments:', completedError)
  } else {
    console.log(`Found ${completedPayments?.length || 0} recent completed payments:`)
    completedPayments?.forEach(payment => {
      console.log(`  - Payment ${payment.id}: $${payment.final_amount/100}`)
      console.log(`    User: ${payment.users ? `${payment.users.first_name} ${payment.users.last_name}` : 'Unknown'}`)
      console.log(`    Completed: ${payment.completed_at}`)
      console.log(`    Xero Synced: ${payment.xero_synced ? 'Yes' : 'No'}`)
      if (payment.xero_sync_error) console.log(`    Xero Error: ${payment.xero_sync_error}`)
      console.log('')
    })
  }

  // Check Xero connection status
  console.log('🔗 Xero Connection Status:)
  const { data: connections, error: connectionError } = await supabase
    .from('xero_oauth_tokens')
    .select('*')
    .order('created_at', { ascending: false })

  if (connectionError) {
    console.error('❌ Error fetching Xero connections:', connectionError)
  } else {
    console.log(`Found ${connections?.length || 0} Xero connections:`)
    connections?.forEach(conn => {
      const expiresAt = new Date(conn.expires_at)
      const now = new Date()
      const isExpired = now >= expiresAt
      console.log(`  - Tenant: ${conn.tenant_name} (${conn.tenant_id})`)
      console.log(`    Expires: ${conn.expires_at} ${isExpired ? '(EXPIRED)' : '(Valid)'}`)
      console.log(`    Created: ${conn.created_at}`)
      console.log('')
    })
  }

  console.log(🔍 Debug complete!)
}
debugXeroPayments().catch(console.error) 