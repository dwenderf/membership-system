const { createClient } = require('@supabase/supabase-js')

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function debugXeroPaymentSync() {
  console.log('🔍 Debugging Xero payment sync...\n')

  try {
    // 1. Check xero_invoices table
    console.log('📄 Checking xero_invoices table...')
    const { data: invoices, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    if (invoiceError) {
      console.error('❌ Error fetching invoices:', invoiceError)
      return
    }

    console.log(`Found ${invoices.length} recent invoices:`)
    invoices.forEach(invoice => {
      console.log(`  - ID: ${invoice.id}`)
      console.log(`    Payment ID: ${invoice.payment_id}`)
      console.log(`    Sync Status: ${invoice.sync_status}`)
      console.log(`    Xero Invoice ID: ${invoice.xero_invoice_id}`)
      console.log(`    Created: ${invoice.created_at}`)
      console.log('')
    })

    // 2. Check xero_payments table
    console.log('💰 Checking xero_payments table...')
    const { data: payments, error: paymentError } = await supabase
      .from('xero_payments')
      .select('*')
      .order('created_at', { ascending: false })

    if (paymentError) {
      console.error('❌ Error fetching payments:', paymentError)
      return
    }

    console.log(`Found ${payments.length} payment records:`)
    payments.forEach(payment => {
      console.log(`  - ID: ${payment.id}`)
      console.log(`    Xero Invoice ID: ${payment.xero_invoice_id}`)
      console.log(`    Sync Status: ${payment.sync_status}`)
      console.log(`    Amount: ${payment.amount_paid}`)
      console.log('')
    })

    // 3. Check payments table
    console.log('💳 Checking payments table...')
    const { data: stripePayments, error: stripeError } = await supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    if (stripeError) {
      console.error('❌ Error fetching stripe payments:', stripeError)
      return
    }

    console.log(`Found ${stripePayments.length} recent stripe payments:`)
    stripePayments.forEach(payment => {
      console.log(`  - ID: ${payment.id}`)
      console.log(`    Status: ${payment.status}`)
      console.log(`    Xero Synced: ${payment.xero_synced}`)
      console.log(`    Amount: ${payment.final_amount}`)
      console.log('')
    })

    // 4. Find invoices that need payment records
    console.log('🔍 Finding invoices that need payment records...')
    const { data: invoicesNeedingPayments, error: needError } = await supabase
      .from('xero_invoices')
      .select(`
        id,
        payment_id,
        tenant_id,
        net_amount,
        sync_status,
        payments (
          id,
          status,
          final_amount,
          stripe_payment_intent_id
        )
      `)
      .eq('sync_status', 'synced')
      .not('payment_id', 'is', null)

    if (needError) {
      console.error('❌ Error finding invoices needing payments:', needError)
      return
    }

    console.log(`Found ${invoicesNeedingPayments.length} synced invoices with payment IDs:`)
    
    for (const invoice of invoicesNeedingPayments) {
      // Check if payment record exists
      const { data: existingPayment } = await supabase
        .from('xero_payments')
        .select('id')
        .eq('xero_invoice_id', invoice.id)
        .single()

      const payment = Array.isArray(invoice.payments) ? invoice.payments[0] : invoice.payments
      
      console.log(`  - Invoice ID: ${invoice.id}`)
      console.log(`    Payment ID: ${invoice.payment_id}`)
      console.log(`    Payment Status: ${payment?.status}`)
      console.log(`    Has Xero Payment Record: ${!!existingPayment}`)
      
      if (!existingPayment && payment?.status === 'completed') {
        console.log(`    ⚠️  MISSING: Should create xero_payment record`)
        
        // Create the missing payment record
        try {
          const { data: newPayment, error: createError } = await supabase
            .from('xero_payments')
            .insert({
              xero_invoice_id: invoice.id,
              tenant_id: invoice.tenant_id,
              xero_payment_id: null,
              payment_method: 'stripe',
              bank_account_code: 'STRIPE',
              amount_paid: payment.final_amount,
              stripe_fee_amount: 0,
              reference: payment.stripe_payment_intent_id || 'unknown',
              sync_status: 'pending',
              staged_at: new Date().toISOString(),
              staging_metadata: {
                payment_id: payment.id,
                stripe_payment_intent_id: payment.stripe_payment_intent_id,
                created_at: new Date().toISOString()
              }
            })
            .select()
            .single()

          if (createError) {
            console.log(`    ❌ Failed to create payment record: ${createError.message}`)
          } else {
            console.log(`    ✅ Created payment record: ${newPayment.id}`)
          }
        } catch (error) {
          console.log(`    ❌ Exception creating payment record: ${error.message}`)
        }
      }
      console.log('')
    }

  } catch (error) {
    console.error('❌ Error in debug script:', error)
  }
}

// Run the debug function
debugXeroPaymentSync()
  .then(() => {
    console.log('✅ Debug completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Debug failed:', error)
    process.exit(1)
  }) 