/**
 * Debug script to create missing Xero payment records for a user
 * 
 * This script finds completed payments that don't have corresponding
 * Xero payment records and creates them. It's useful for:
 * 
 * - Fixing cases where payments exist but Xero payment records are missing
 * - Creating Xero payment staging records for payments that should sync to Xero
 * - Debugging issues where payments aren't appearing in Xero
 * - Ensuring all completed payments have proper Xero staging records
 * 
 * Usage: node scripts/debug/create-missing-xero-payments.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to create missing Xero payments for
 * 
 * Note: This script creates new Xero payment records with 'pending' status.
 * Run a manual sync from the admin page to sync them to Xero.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function createMissingXeroPayments(userId) {
  console.log(`🔧 Creating missing Xero payment records for user: ${userId}`)
  
  try {
    // Get the user's completed payments
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('id, final_amount, stripe_payment_intent_id')
      .eq('user_id', userId)
      .eq('status', 'completed')
    
    if (paymentsError) {
      console.error('❌ Error fetching payments:', paymentsError)
      return
    }
    
    console.log(`\n💰 Found ${payments.length} completed payments:`)
    payments.forEach((payment, i) => {
      console.log(`${i+1}. Payment ID: ${payment.id}`)
      console.log(`   Amount: $${(payment.final_amount / 100).toFixed(2)}`)
      console.log(`   Stripe Intent: ${payment.stripe_payment_intent_id}`)
    })
    
    // Get the corresponding Xero invoices for these payments
    const paymentIds = payments.map(p => p.id)
    const { data: xeroInvoices, error: invoicesError } = await supabase
      .from('xero_invoices')
      .select('id, xero_invoice_id, net_amount, payment_id')
      .in('payment_id', paymentIds)
    
    if (invoicesError) {
      console.error('❌ Error fetching Xero invoices:', invoicesError)
      return
    }
    
    console.log(`\n📄 Found ${xeroInvoices.length} corresponding Xero invoices:`)
    xeroInvoices.forEach((invoice, i) => {
      console.log(`${i+1}. Xero Invoice ID: ${invoice.id}`)
      console.log(`   Payment ID: ${invoice.payment_id}`)
      console.log(`   Xero Invoice ID: ${invoice.xero_invoice_id}`)
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
    })
    
    // Create Xero payment records for each payment that doesn't have one
    const createdPayments = []
    
    for (const payment of payments) {
      // Check if Xero payment already exists
      const { data: existingXeroPayment } = await supabase
        .from('xero_payments')
        .select('id')
        .eq('staging_metadata->>payment_id', payment.id)
        .single()
      
      if (existingXeroPayment) {
        console.log(`⚠️  Xero payment already exists for payment ${payment.id}`)
        continue
      }
      
      // Find the corresponding Xero invoice
      const xeroInvoice = xeroInvoices.find(invoice => invoice.payment_id === payment.id)
      if (!xeroInvoice) {
        console.log(`❌ No Xero invoice found for payment ${payment.id}`)
        continue
      }
      
      // Get the Stripe bank account code from system_accounting_codes
      const { data: stripeAccountCode } = await supabase
        .from('system_accounting_codes')
        .select('accounting_code')
        .eq('code_type', 'stripe_bank_account')
        .single()

      const bankAccountCode = stripeAccountCode?.accounting_code || '090'

      // Create the Xero payment record
      const xeroPaymentData = {
        xero_invoice_id: xeroInvoice.id,
        amount_paid: payment.final_amount,
        bank_account_code: bankAccountCode,
        reference: payment.stripe_payment_intent_id,
        sync_status: 'pending',
        staging_metadata: {
          payment_id: payment.id,
          user_id: userId,
          stripe_payment_intent_id: payment.stripe_payment_intent_id,
          created_at: new Date().toISOString()
        }
      }
      
      console.log(`\n📝 Creating Xero payment for payment ${payment.id}:`)
      console.log(`   Amount: $${(payment.final_amount / 100).toFixed(2)}`)
      console.log(`   Xero Invoice ID: ${xeroInvoice.id}`)
      console.log(`   Stripe Intent: ${payment.stripe_payment_intent_id}`)
      
      const { data: newXeroPayment, error: createError } = await supabase
        .from('xero_payments')
        .insert(xeroPaymentData)
        .select()
        .single()
      
      if (createError) {
        console.error(`❌ Error creating Xero payment for ${payment.id}:`, createError)
      } else {
        console.log(`✅ Created Xero payment: ${newXeroPayment.id}`)
        createdPayments.push(newXeroPayment)
      }
    }
    
    console.log(`\n🎉 Summary:`)
    console.log(`- Created ${createdPayments.length} Xero payment records`)
    console.log(`- These payments are now in 'pending' status and ready to sync`)
    console.log(`- Run a manual sync from the admin page to sync them to Xero`)
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/create-missing-xero-payments.js <user_id>')
  process.exit(1)
}

createMissingXeroPayments(userId) 