/**
 * Debug script to check completed payments for a specific user
 * 
 * This script queries the payments table to find all completed payments
 * for a specific user. It's useful for:
 * 
 * - Understanding a user's payment history
 * - Identifying completed payments that should have Xero records
 * - Debugging payment-related issues
 * - Validating payment data integrity
 * 
 * Usage: node scripts/debug/check-user-payments.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to check payments for
 * 
 * Note: This script only shows completed payments. For a complete view
 * including pending/failed payments, modify the query as needed.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkUserPayments(userId) {
  console.log(`🔍 Checking completed payments for user: ${userId}`)
  
  const { data: payments, error } = await supabase
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`\n💰 Found ${payments.length} payments:`)
  payments.forEach((payment, i) => {
    console.log(`${i+1}. ID: ${payment.id}`)
    console.log(`   Stripe Intent: ${payment.stripe_payment_intent_id}`)
    console.log(`   Created: ${payment.created_at}`)
    console.log(`   Completed: ${payment.completed_at}`)
    console.log(`   Status: ${payment.status}`)
    console.log(`   All fields:`, JSON.stringify(payment, null, 2))
    console.log('')
  })
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/check-user-payments.js <user_id>')
  process.exit(1)
}

checkUserPayments(userId) 