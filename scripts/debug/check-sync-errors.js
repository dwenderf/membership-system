/**
 * Debug script to check sync errors for Xero records for a specific user
 * 
 * This script identifies and displays all failed Xero sync attempts for a user,
 * showing both invoice and payment sync errors. It's useful for:
 * 
 * - Identifying which Xero sync operations have failed
 * - Understanding the specific error messages from failed syncs
 * - Debugging Xero API integration issues
 * - Planning fixes for failed sync operations
 * 
 * Usage: node scripts/debug/check-sync-errors.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to check sync errors for
 * 
 * Note: This script shows both failed invoices and failed payments,
 * along with their specific error messages from the Xero API.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkSyncErrors(userId) {
  console.log(`🔍 Checking sync errors for user: ${userId}`)
  
  try {
    // Check failed invoices
    const { data: failedInvoices, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select('id, sync_error, sync_status, net_amount, payment_id, xero_invoice_id, invoice_number')
      .eq('staging_metadata->>user_id', userId)
      .eq('sync_status', 'failed')
    
    if (invoiceError) {
      console.error('❌ Error fetching failed invoices:', invoiceError)
      return
    }
    
    console.log(`\n📄 Failed Invoices (${failedInvoices.length}):`)
    failedInvoices.forEach((invoice, i) => {
      console.log(`${i+1}. ID: ${invoice.id}`)
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Payment ID: ${invoice.payment_id}`)
      console.log(`   Xero Invoice ID: ${invoice.xero_invoice_id}`)
      console.log(`   Invoice Number: ${invoice.invoice_number}`)
      console.log(`   Sync Error: ${invoice.sync_error}`)
      console.log('')
    })
    
    // Check failed payments
    const { data: failedPayments, error: paymentError } = await supabase
      .from('xero_payments')
      .select('id, sync_error, sync_status, amount_paid, xero_invoice_id, xero_payment_id')
      .eq('staging_metadata->>user_id', userId)
      .eq('sync_status', 'failed')
    
    if (paymentError) {
      console.error('❌ Error fetching failed payments:', paymentError)
      return
    }
    
    console.log(`💳 Failed Payments (${failedPayments.length}):`)
    failedPayments.forEach((payment, i) => {
      console.log(`${i+1}. ID: ${payment.id}`)
      console.log(`   Amount: $${(payment.amount_paid / 100).toFixed(2)}`)
      console.log(`   Xero Invoice ID: ${payment.xero_invoice_id}`)
      console.log(`   Xero Payment ID: ${payment.xero_payment_id}`)
      console.log(`   Sync Error: ${payment.sync_error}`)
      console.log('')
    })
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/check-sync-errors.js <user_id>')
  process.exit(1)
}

checkSyncErrors(userId) 