/**
 * Debug script to analyze a user's complete Xero integration status
 * 
 * This script provides a comprehensive view of a user's payment and Xero sync status
 * by examining all related records across multiple tables. It's useful for:
 * 
 * - Diagnosing payment misassignment issues
 * - Understanding why Xero sync is failing for a specific user
 * - Verifying that payments are correctly linked to invoices
 * - Checking if registrations have the correct payment associations
 * - Debugging duplicate payment or invoice creation issues
 * 
 * Usage: node scripts/debug/debug-user-xero-records.js <user_id>
 * 
 * Example: node scripts/debug/debug-user-xero-records.js ac310eae-e081-4af7-9083-39161ecfe829
 */

/**
 * Debug script to analyze all Xero-related records for a specific user
 * 
 * This script provides a comprehensive analysis of all Xero-related data
 * for a specific user, including payments, invoices, and sync status.
 * It's useful for:
 * 
 * - Getting a complete picture of a user's Xero integration status
 * - Debugging complex Xero sync issues involving multiple records
 * - Understanding the relationship between payments, invoices, and Xero records
 * - Identifying discrepancies between our system and Xero
 * 
 * Usage: node scripts/debug/debug-user-xero-records.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to analyze Xero records for
 * 
 * Note: This script provides the most comprehensive view of a user's
 * Xero integration status and is useful for complex debugging scenarios.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function debugUserXeroRecords(userId) {
  console.log(`🔍 Debugging Xero records for user: ${userId}`)
  
  try {
    // Get user details to confirm we're looking at the right person
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()
    
    if (userError) {
      console.error('❌ Error finding user:', userError)
      return
    }
    
    console.log(`👤 User: ${user.first_name} ${user.last_name} (${user.email})`)
    
    // Get all payments for this user from the payments table
    // This shows the actual Stripe payments that were processed
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    
    if (paymentsError) {
      console.error('❌ Error fetching payments:', paymentsError)
      return
    }
    
    console.log(`\n💰 Payments (${payments.length}):`)
    payments.forEach((payment, index) => {
      console.log(`${index + 1}. ID: ${payment.id}`)
      console.log(`   Amount: $${(payment.final_amount / 100).toFixed(2)}`)
      console.log(`   Status: ${payment.status}`)
      console.log(`   Stripe Intent: ${payment.stripe_payment_intent_id}`)
      console.log(`   Created: ${payment.created_at}`)
      console.log(`   Completed: ${payment.completed_at}`)
      console.log('')
    })
    
    // Get all Xero invoices for this user
    // This shows what invoices were created/staged for Xero sync
    const { data: xeroInvoices, error: invoicesError } = await supabase
      .from('xero_invoices')
      .select('*')
      .eq('staging_metadata->>user_id', userId)
      .order('created_at', { ascending: false })
    
    if (invoicesError) {
      console.error('❌ Error fetching Xero invoices:', invoicesError)
      return
    }
    
    console.log(`📄 Xero Invoices (${xeroInvoices.length}):`)
    xeroInvoices.forEach((invoice, index) => {
      console.log(`${index + 1}. ID: ${invoice.id}`)
      console.log(`   Payment ID: ${invoice.payment_id}`)
      console.log(`   Xero Invoice ID: ${invoice.xero_invoice_id}`)
      console.log(`   Invoice Number: ${invoice.invoice_number}`)
      console.log(`   Sync Status: ${invoice.sync_status}`)
      console.log(`   Invoice Status: ${invoice.invoice_status}`)
      console.log(`   Net Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Created: ${invoice.created_at}`)
      console.log(`   Staged: ${invoice.staged_at}`)
      console.log('')
    })
    
    // Get all Xero payments for this user
    // This shows what payment records were created/staged for Xero sync
    const { data: xeroPayments, error: paymentsError2 } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('staging_metadata->>user_id', userId)
      .order('created_at', { ascending: false })
    
    if (paymentsError2) {
      console.error('❌ Error fetching Xero payments:', paymentsError2)
      return
    }
    
    console.log(`💳 Xero Payments (${xeroPayments.length}):`)
    xeroPayments.forEach((payment, index) => {
      console.log(`${index + 1}. ID: ${payment.id}`)
      console.log(`   Xero Invoice ID: ${payment.xero_invoice_id}`)
      console.log(`   Xero Payment ID: ${payment.xero_payment_id}`)
      console.log(`   Amount Paid: $${(payment.amount_paid / 100).toFixed(2)}`)
      console.log(`   Sync Status: ${payment.sync_status}`)
      console.log(`   Created: ${payment.created_at}`)
      console.log(`   Staged: ${payment.staged_at}`)
      console.log('')
    })
    
    // Get user registrations to see what they actually purchased
    // This helps verify that payments are linked to the correct registrations
    const { data: registrations, error: regError } = await supabase
      .from('user_registrations')
      .select(`
        *,
        registration:registrations (name),
        registration_category:registration_categories (
          custom_name,
          category:categories (name)
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    
    if (regError) {
      console.error('❌ Error fetching registrations:', regError)
      return
    }
    
    console.log(`🏒 Registrations (${registrations.length}):`)
    registrations.forEach((reg, index) => {
      console.log(`${index + 1}. ID: ${reg.id}`)
      console.log(`   Registration: ${reg.registration.name}`)
      console.log(`   Category: ${reg.registration_category?.custom_name || reg.registration_category?.category?.name}`)
      console.log(`   Payment Status: ${reg.payment_status}`)
      console.log(`   Amount Paid: $${(reg.amount_paid / 100).toFixed(2)}`)
      console.log(`   Payment ID: ${reg.payment_id}`)
      console.log(`   Created: ${reg.created_at}`)
      console.log('')
    })
    
    // Summary and analysis hints
    console.log(`\n📊 Analysis Summary:`)
    console.log(`- User has ${payments.length} payments, ${xeroInvoices.length} Xero invoices, ${xeroPayments.length} Xero payments`)
    console.log(`- Check if payment amounts match between payments and Xero invoices`)
    console.log(`- Verify that Xero invoices have correct payment_id links`)
    console.log(`- Look for any failed sync statuses that need attention`)
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

// Get user ID from command line argument
const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID as an argument')
  console.log('Usage: node scripts/debug/debug-user-xero-records.js <user_id>')
  process.exit(1)
}

debugUserXeroRecords(userId) 