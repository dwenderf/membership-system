/**
 * Debug script to check Xero payment records for a specific user
 * 
 * This script provides a focused view of a user's Xero payment sync status.
 * It's useful for:
 * 
 * - Checking if Xero payments are being created correctly
 * - Verifying payment sync status (pending, processing, synced, failed)
 * - Identifying payments that are stuck in pending status
 * - Debugging why specific payments aren't syncing to Xero
 * - Quick verification of payment amounts and associations
 * 
 * Usage: node scripts/debug/check-xero-payments.js <user_id>
 * 
 * Example: node scripts/debug/check-xero-payments.js ac310eae-e081-4af7-9083-39161ecfe829
 */

/**
 * Debug script to check Xero payment records for a specific user
 * 
 * This script analyzes Xero payment records to understand their sync status
 * and identify potential issues with payment processing. It's useful for:
 * 
 * - Checking the status of Xero payment records for a specific user
 * - Identifying payments that are stuck in various sync states
 * - Debugging payment sync issues and understanding payment flow
 * - Validating that payment records are being created and synced correctly
 * 
 * Usage: node scripts/debug/check-xero-payments.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to check Xero payments for
 * 
 * Note: This script provides a comprehensive view of all Xero payment records
 * associated with a user, including their sync status and staging metadata.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkXeroPayments(userId) {
  console.log(`🔍 Checking Xero payments for user: ${userId}`)
  
  try {
    // First, get the user's completed payments
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('id, final_amount, stripe_payment_intent_id')
      .eq('user_id', userId)
      .eq('status', 'completed')
    
    if (paymentsError) {
      console.error('❌ Error fetching payments:', paymentsError)
      return
    }
    
    console.log(`\n💰 User has ${payments.length} completed payments:`)
    payments.forEach((payment, i) => {
      console.log(`${i+1}. Payment ID: ${payment.id}`)
      console.log(`   Amount: $${(payment.final_amount / 100).toFixed(2)}`)
      console.log(`   Stripe Intent: ${payment.stripe_payment_intent_id}`)
    })
    
    // Check for Xero payments by user_id in staging_metadata
    console.log(`\n🔍 Checking for Xero payments for user: ${userId}`)
    
    const { data: xeroPayments, error: xeroError } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('staging_metadata->>user_id', userId)
    
    if (xeroError) {
      console.error('❌ Error fetching Xero payments:', xeroError)
      return
    }
    
    console.log(`\n💳 Found ${xeroPayments.length} Xero payments:`)
    if (xeroPayments.length === 0) {
      console.log('❌ No Xero payment records found for this user')
      console.log('💡 This means the Xero payment staging records need to be created')
    } else {
      xeroPayments.forEach((xeroPayment, i) => {
        console.log(`${i+1}. Xero Payment ID: ${xeroPayment.id}`)
        console.log(`   Amount: $${(xeroPayment.amount_paid / 100).toFixed(2)}`)
        console.log(`   Sync Status: ${xeroPayment.sync_status}`)
        console.log(`   Xero Invoice ID: ${xeroPayment.xero_invoice_id}`)
        console.log(`   Staging Metadata:`, JSON.stringify(xeroPayment.staging_metadata, null, 2))
        console.log('')
      })
    }
    
    // Check for staged Xero payments specifically
    console.log(`\n🔍 Checking for staged Xero payments:`)
    const { data: stagedPayments, error: stagedError } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('sync_status', 'staged')
    
    if (stagedError) {
      console.error('❌ Error fetching staged payments:', stagedError)
      return
    }
    
    console.log(`\n📦 Found ${stagedPayments.length} staged Xero payments:`)
    
    // Check if any staged payments match our payment IDs
    const paymentIds = payments.map(p => p.id)
    const matchingStaged = stagedPayments.filter(sp => {
      const metadata = sp.staging_metadata || {}
      return paymentIds.includes(metadata.payment_id)
    })
    
    console.log(`\n🎯 Found ${matchingStaged.length} staged payments matching our payment IDs:`)
    matchingStaged.forEach((stagedPayment, i) => {
      console.log(`${i+1}. Xero Payment ID: ${stagedPayment.id}`)
      console.log(`   Amount: $${(stagedPayment.amount_paid / 100).toFixed(2)}`)
      console.log(`   Sync Status: ${stagedPayment.sync_status}`)
      console.log(`   Xero Invoice ID: ${stagedPayment.xero_invoice_id}`)
      console.log(`   Payment ID: ${stagedPayment.staging_metadata?.payment_id}`)
      console.log(`   Stripe Intent: ${stagedPayment.staging_metadata?.stripe_payment_intent_id}`)
      console.log('')
    })
    
    if (matchingStaged.length > 0) {
      console.log('💡 These staged payments can be reset to pending status to sync them')
    }
    
    // Show a few staged payments to understand their structure
    console.log(`\n📋 Sample staged payments structure:`)
    stagedPayments.slice(0, 3).forEach((stagedPayment, i) => {
      console.log(`${i+1}. Xero Payment ID: ${stagedPayment.id}`)
      console.log(`   Amount: $${(stagedPayment.amount_paid / 100).toFixed(2)}`)
      console.log(`   Xero Invoice ID: ${stagedPayment.xero_invoice_id}`)
      console.log(`   Staging Metadata:`, JSON.stringify(stagedPayment.staging_metadata, null, 2))
      console.log('')
    })
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/check-xero-payments.js <user_id>')
  process.exit(1)
}

checkXeroPayments(userId) 