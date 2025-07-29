/**
 * Debug script to fix incorrect Xero payment records for a user
 * 
 * This script identifies and fixes incorrect Xero payment records by
 * marking old ones as 'ignored' and creating new, correct ones. It's useful for:
 * 
 * - Fixing Xero payment records with incorrect account codes or amounts
 * - Replacing incorrect payment records with proper ones
 * - Ensuring Xero payment records have the correct Stripe account codes
 * - Debugging and fixing payment sync issues
 * 
 * Usage: node scripts/debug/fix-incorrect-xero-payments.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to fix Xero payment records for
 * 
 * Note: This script marks old records as 'ignored' and creates new ones with
 * 'pending' status. Run a manual sync from the admin page to sync them to Xero.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixIncorrectXeroPayments(userId) {
  console.log(`🔧 Fixing incorrect Xero payment records for user: ${userId}`)
  
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
    
    // Step 1: Mark incorrect Xero payment records as ignored
    console.log(`\n🚫 Step 1: Marking incorrect Xero payment records as ignored...`)
    const ignoredPayments = []
    
    for (const payment of payments) {
      // Find existing Xero payment for this payment ID
      const { data: existingXeroPayments, error: findError } = await supabase
        .from('xero_payments')
        .select('id, amount_paid, xero_invoice_id')
        .eq('staging_metadata->>payment_id', payment.id)
      
      if (findError) {
        console.error(`❌ Error finding Xero payments for ${payment.id}:`, findError)
        continue
      }
      
      if (existingXeroPayments.length > 0) {
        for (const existingPayment of existingXeroPayments) {
          console.log(`🚫 Marking Xero payment ${existingPayment.id} as ignored for payment ${payment.id}`)
          console.log(`   Amount: $${(existingPayment.amount_paid / 100).toFixed(2)} (should be $${(payment.final_amount / 100).toFixed(2)})`)
          
          const { error: updateError } = await supabase
            .from('xero_payments')
            .update({ 
              sync_status: 'ignore',
              sync_error: 'Incorrect payment record - replaced with correct one',
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPayment.id)
          
          if (updateError) {
            console.error(`❌ Error marking Xero payment ${existingPayment.id} as ignored:`, updateError)
          } else {
            console.log(`✅ Marked Xero payment ${existingPayment.id} as ignored`)
            ignoredPayments.push(existingPayment.id)
          }
        }
      } else {
        console.log(`ℹ️  No existing Xero payment found for payment ${payment.id}`)
      }
    }
    
    // Step 2: Create correct Xero payment records
    console.log(`\n📝 Step 2: Creating correct Xero payment records...`)
    const createdPayments = []
    
    for (const payment of payments) {
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

      // Create the correct Xero payment record
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
      
      console.log(`\n📝 Creating correct Xero payment for payment ${payment.id}:`)
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
    console.log(`- Marked ${ignoredPayments.length} incorrect Xero payment records as ignored`)
    console.log(`- Created ${createdPayments.length} correct Xero payment records`)
    console.log(`- These payments are now in 'pending' status and ready to sync`)
    console.log(`- Run a manual sync from the admin page to sync them to Xero`)
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/fix-incorrect-xero-payments.js <user_id>')
  process.exit(1)
}

fixIncorrectXeroPayments(userId) 