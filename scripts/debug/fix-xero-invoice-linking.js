/**
 * Debug script to analyze and generate SQL fixes for Xero invoice linking issues
 * 
 * This script analyzes a user's payment and Xero invoice records to identify
 * mislinked invoices and generates SQL commands to fix them. It's useful for:
 * 
 * - Diagnosing payment misassignment issues (like the $645 vs $50 payment problem)
 * - Identifying invoices that are linked to the wrong payments
 * - Generating SQL commands to fix incorrect payment_id associations
 * - Marking old synced invoices as 'staged' to exclude them from reporting
 * - Ensuring financial reporting accuracy by fixing payment-invoice relationships
 * 
 * The script analyzes the data and provides a detailed plan before generating
 * SQL commands, so you can review the changes before applying them.
 * 
 * Usage: node scripts/debug/fix-xero-invoice-linking.js <user_id>
 * 
 * Example: node scripts/debug/fix-xero-invoice-linking.js ac310eae-e081-4af7-9083-39161ecfe829
 * 
 * Note: This script only generates SQL commands - it doesn't execute them.
 * Review the generated SQL and run it manually in your Supabase SQL editor.
 */

/**
 * Debug script to analyze and generate SQL commands for fixing Xero invoice linking
 * 
 * This script analyzes a user's Xero invoice and payment records to identify
 * incorrect linking and generates SQL commands to fix the issues. It's useful for:
 * 
 * - Identifying incorrectly linked Xero invoices and payments
 * - Generating SQL commands to fix payment-to-invoice relationships
 * - Debugging issues where payments are assigned to wrong invoices
 * - Preparing fixes for Xero sync issues
 * 
 * Usage: node scripts/debug/fix-xero-invoice-linking.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to analyze and generate fixes for
 * 
 * Note: This script only generates SQL commands - it doesn't execute them.
 * Review the generated SQL carefully before applying it to the database.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixXeroInvoiceLinking(userId) {
  console.log(`🔧 Fixing Xero invoice linking for user: ${userId}`)
  
  try {
    // Get user details to confirm we're working with the right person
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
    
    // Get all completed payments for this user
    // These are the actual Stripe payments that were processed successfully
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
    
    if (paymentsError) {
      console.error('❌ Error fetching payments:', paymentsError)
      return
    }
    
    console.log(`\n💰 Completed Payments (${payments.length}):`)
    payments.forEach((payment, index) => {
      console.log(`${index + 1}. ID: ${payment.id}`)
      console.log(`   Amount: $${(payment.final_amount / 100).toFixed(2)}`)
      console.log(`   Stripe Intent: ${payment.stripe_payment_intent_id}`)
      console.log(`   Created: ${payment.created_at}`)
      console.log('')
    })
    
    // Get all Xero invoices for this user
    // These are the invoice records that get synced to Xero
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
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Payment ID: ${invoice.payment_id}`)
      console.log(`   Sync Status: ${invoice.sync_status}`)
      console.log(`   Xero Invoice ID: ${invoice.xero_invoice_id}`)
      console.log(`   Invoice Number: ${invoice.invoice_number}`)
      console.log(`   Created: ${invoice.created_at}`)
      console.log('')
    })
    
    // Create mapping plan by analyzing payment-invoice relationships
    console.log('🔧 Analysis and Fix Plan:')
    console.log('')
    
    const fixPlan = []
    
    // For each completed payment, find the correct invoice and identify mismatches
    payments.forEach(payment => {
      // Find the correct staging invoice that matches this payment's amount
      const correctInvoice = xeroInvoices.find(invoice => 
        invoice.net_amount === payment.final_amount && 
        invoice.sync_status === 'staged' &&
        !invoice.payment_id
      )
      
      // Find the invoice that's currently linked to this payment
      const currentlyLinkedInvoice = xeroInvoices.find(invoice => 
        invoice.payment_id === payment.id
      )
      
      // Case 1: Payment is linked to wrong invoice (most common issue)
      if (correctInvoice && currentlyLinkedInvoice && correctInvoice.id !== currentlyLinkedInvoice.id) {
        console.log(`💰 Payment $${(payment.final_amount / 100).toFixed(2)} (${payment.id}):`)
        console.log(`   ❌ Currently linked to: ${currentlyLinkedInvoice.id} ($${(currentlyLinkedInvoice.net_amount / 100).toFixed(2)})`)
        console.log(`   ✅ Should be linked to: ${correctInvoice.id} ($${(correctInvoice.net_amount / 100).toFixed(2)})`)
        console.log('')
        
        fixPlan.push({
          payment,
          correctInvoice,
          currentlyLinkedInvoice
        })
      } 
      // Case 2: Payment should be linked but isn't currently linked
      else if (correctInvoice && !currentlyLinkedInvoice) {
        console.log(`💰 Payment $${(payment.final_amount / 100).toFixed(2)} (${payment.id}):`)
        console.log(`   ✅ Should be linked to: ${correctInvoice.id} ($${(correctInvoice.net_amount / 100).toFixed(2)})`)
        console.log('')
        
        fixPlan.push({
          payment,
          correctInvoice,
          currentlyLinkedInvoice: null
        })
      } 
      // Case 3: Payment is linked but no correct staging record exists
      else if (currentlyLinkedInvoice && !correctInvoice) {
        console.log(`💰 Payment $${(payment.final_amount / 100).toFixed(2)} (${payment.id}):`)
        console.log(`   ❌ Currently linked to wrong invoice: ${currentlyLinkedInvoice.id} ($${(currentlyLinkedInvoice.net_amount / 100).toFixed(2)})`)
        console.log(`   ⚠️  No correct staging record found - will unlink`)
        console.log('')
        
        fixPlan.push({
          payment,
          correctInvoice: null,
          currentlyLinkedInvoice
        })
      }
    })
    
    // Find existing synced invoices that need to be marked as staged
    // These are old invoices that were synced incorrectly and should be excluded from reporting
    const existingSyncedInvoices = xeroInvoices.filter(invoice => 
      invoice.sync_status === 'synced' && 
      invoice.payment_id
    )
    
    if (existingSyncedInvoices.length > 0) {
      console.log('📄 Existing synced invoices (will mark as staged to exclude from reporting):')
      existingSyncedInvoices.forEach(invoice => {
        console.log(`   ${invoice.id} ($${(invoice.net_amount / 100).toFixed(2)}) - ${invoice.invoice_number}`)
      })
      console.log('')
    }
    
    if (fixPlan.length === 0 && existingSyncedInvoices.length === 0) {
      console.log('✅ No fixes needed - all invoices are correctly linked!')
      return
    }
    
    // Generate SQL commands to fix the issues
    console.log('📝 SQL commands to run:')
    console.log('')
    
    // Step 1: Mark existing synced invoices as staged (to exclude from reporting)
    // This prevents old incorrect invoices from appearing in financial reports
    if (existingSyncedInvoices.length > 0) {
      console.log('-- Step 1: Mark existing synced invoices as staged (exclude from reporting)')
      existingSyncedInvoices.forEach(invoice => {
        console.log(`UPDATE xero_invoices SET sync_status = 'staged', payment_id = NULL WHERE id = '${invoice.id}';`)
      })
      console.log('')
    }
    
    // Step 2: Link payments to correct staging records
    // This ensures each payment is associated with the correct invoice amount
    fixPlan.forEach((plan, index) => {
      console.log(`-- Step ${index + 2}: Payment $${(plan.payment.final_amount / 100).toFixed(2)}`)
      
      if (plan.correctInvoice) {
        console.log(`-- Link payment to correct invoice`)
        console.log(`UPDATE xero_invoices SET payment_id = '${plan.payment.id}' WHERE id = '${plan.correctInvoice.id}';`)
        console.log('')
        
        console.log(`-- Update staging metadata to include payment intent ID`)
        console.log(`UPDATE xero_invoices SET staging_metadata = staging_metadata || '{"stripe_payment_intent_id": "${plan.payment.stripe_payment_intent_id}"}' WHERE id = '${plan.correctInvoice.id}';`)
        console.log('')
        
        console.log(`-- Mark the correct invoice as pending for sync`)
        console.log(`UPDATE xero_invoices SET sync_status = 'pending' WHERE id = '${plan.correctInvoice.id}';`)
        console.log('')
      }
    })
    
    // Provide guidance on what happens after running the SQL
    console.log('💡 After running these commands:')
    console.log('1. Existing wrong invoices (INV-6903, INV-6904) will be marked as staged')
    console.log('2. They will not appear in financial reporting')
    console.log('3. You can safely void them in Xero without affecting our system')
    console.log('4. The Xero sync process will create new, correct invoices')
    console.log('5. Each payment will be synced with the correct amount')
    console.log('6. Financial reporting will be accurate')
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

// Get user ID from command line argument
const userId = process.argv[2]

if (!userId) {
  console.error('❌ Please provide a user ID as an argument')
  console.log('Usage: node scripts/debug/fix-xero-invoice-linking.js <user_id>')
  console.log('Example: node scripts/debug/fix-xero-invoice-linking.js ac310eae-e081-4af7-9083-39161ecfe829')
  process.exit(1)
}

fixXeroInvoiceLinking(userId) 