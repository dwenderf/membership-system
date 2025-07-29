const { createClient } = require('@supabase/supabase-js')

async function debugUserInvoices(userId) {
  if (!userId) {
    console.error('❌ Error: user_id parameter is required')
    console.log('Usage: node debug-user-invoices.js <user_id>')
    console.log('Example: node debug-user-invoices.js 79e9a75e-2580-4d56-8d10-d1a6f8542118')
    return
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('🔍 Debugging User Invoices and Payments...\n')

  // Get user details
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, member_id')
    .eq('id', userId)
    .single()

  if (userError) {
    console.error('❌ Error finding user:', userError.message)
    return
  }

  if (!user) {
    console.error('❌ User not found with ID:', userId)
    return
  }

  console.log(`✅ Found user: ${user.first_name} ${user.last_name} (${user.member_id})`)
  console.log(`📧 Email: ${user.email}`)
  console.log(`🆔 User ID: ${user.id}\n`)

  // Get user's payments
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('id, status, final_amount, created_at, completed_at, stripe_payment_intent_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (paymentsError) {
    console.error('❌ Error fetching payments:', paymentsError)
    return
  }

  console.log(`💰 Found ${payments?.length || 0} payments:`)
  payments?.forEach(payment => {
    console.log(`  - Payment ID: ${payment.id}`)
    console.log(`    Amount: $${payment.final_amount/100}`)
    console.log(`    Status: ${payment.status}`)
    console.log(`    Stripe PI: ${payment.stripe_payment_intent_id}`)
    console.log(`    Created: ${payment.created_at}`)
    console.log(`    Completed: ${payment.completed_at || 'Not completed'}`)
    console.log('')
  })

  // Get Xero invoices for this user
  const { data: invoices, error: invoicesError } = await supabase
    .from('xero_invoices')
    .select(`
      id,
      payment_id,
      xero_invoice_id,
      invoice_number,
      invoice_status,
      net_amount,
      sync_status,
      staged_at,
      last_synced_at,
      sync_error,
      staging_metadata
    `)
    .eq('staging_metadata->>user_id', userId)
    .order('staged_at', { ascending: true })

  if (invoicesError) {
    console.error('❌ Error fetching invoices:', invoicesError)
    return
  }

  console.log(`📄 Found ${invoices?.length || 0} Xero invoices:`)
  invoices?.forEach(invoice => {
    console.log(`  - Invoice ID: ${invoice.id}`)
    console.log(`    Invoice Number: ${invoice.invoice_number || 'Not synced'}`)
    console.log(`    Amount: $${invoice.net_amount/100}`)
    console.log(`    Status: ${invoice.invoice_status}`)
    console.log(`    Sync Status: ${invoice.sync_status}`)
    console.log(`    Xero ID: ${invoice.xero_invoice_id || 'Not synced'}`)
    console.log(`    Payment ID: ${invoice.payment_id || 'None'}`)
    console.log(`    Staged: ${invoice.staged_at}`)
    console.log(`    Synced: ${invoice.last_synced_at || 'Not synced'}`)
    if (invoice.sync_error) {
      console.log(`    Sync Error: ${invoice.sync_error}`)
    }
    console.log('')
  })

  // Get Xero payments for this user
  const { data: xeroPayments, error: xeroPaymentsError } = await supabase
    .from('xero_payments')
    .select(`
      id,
      xero_invoice_id,
      xero_payment_id,
      amount_paid,
      sync_status,
      last_synced_at,
      sync_error,
      staging_metadata
    `)
    .eq('staging_metadata->>user_id', userId)
    .order('staged_at', { ascending: true })

  if (xeroPaymentsError) {
    console.error('❌ Error fetching Xero payments:', xeroPaymentsError)
    return
  }

  console.log(`💳 Found ${xeroPayments?.length || 0} Xero payments:`)
  xeroPayments?.forEach(payment => {
    console.log(`  - Payment ID: ${payment.id}`)
    console.log(`    Amount: $${payment.amount_paid/100}`)
    console.log(`    Sync Status: ${payment.sync_status}`)
    console.log(`    Xero Payment ID: ${payment.xero_payment_id || 'Not synced'}`)
    console.log(`    Invoice ID: ${payment.xero_invoice_id}`)
    console.log(`    Synced: ${payment.last_synced_at || 'Not synced'}`)
    if (payment.sync_error) {
      console.log(`    Sync Error: ${payment.sync_error}`)
    }
    console.log('')
  })

  // Summary
  console.log('📊 Summary:')
  console.log(`  - User: ${user.first_name} ${user.last_name} (${user.member_id})`)
  console.log(`  - Payments: ${payments?.length || 0}`)
  console.log(`  - Xero Invoices: ${invoices?.length || 0}`)
  console.log(`  - Xero Payments: ${xeroPayments?.length || 0}`)
  
  // Check for potential issues
  const failedInvoices = invoices?.filter(inv => inv.sync_status === 'failed') || []
  const failedPayments = xeroPayments?.filter(pay => pay.sync_status === 'failed') || []
  
  if (failedInvoices.length > 0) {
    console.log(`  - Failed Invoices: ${failedInvoices.length}`)
  }
  if (failedPayments.length > 0) {
    console.log(`  - Failed Payments: ${failedPayments.length}`)
  }
  
  // Check for duplicate invoice numbers
  const invoiceNumbers = invoices?.map(inv => inv.invoice_number).filter(Boolean) || []
  const duplicateNumbers = invoiceNumbers.filter((num, index) => invoiceNumbers.indexOf(num) !== index)
  
  if (duplicateNumbers.length > 0) {
    console.log(`  - ⚠️  Duplicate Invoice Numbers: ${duplicateNumbers.join(', ')}`)
  }
}

// Get user ID from command line argument
const userId = process.argv[2]

if (!userId) {
  console.error('❌ Error: user_id parameter is required')
  console.log('Usage: node debug-user-invoices.js <user_id>')
  console.log('Example: node debug-user-invoices.js 79e9a75e-2580-4d56-8d10-d1a6f8542118')
  process.exit(1)
}

debugUserInvoices(userId).catch(console.error) 