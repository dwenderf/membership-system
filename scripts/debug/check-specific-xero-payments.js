/**
 * Debug script to check specific Xero payment records by payment ID
 * 
 * This script looks up specific Xero payment records using payment IDs
 * stored in the staging metadata. It's useful for:
 * 
 * - Checking specific Xero payment records by their associated payment ID
 * - Debugging issues with specific payment records
 * - Verifying that payment records exist for specific payments
 * - Understanding the relationship between payments and Xero payment records
 * 
 * Usage: node scripts/debug/check-specific-xero-payments.js <payment_id1> <payment_id2> ...
 * 
 * Arguments:
 * - payment_id1, payment_id2, etc.: The payment IDs to look up Xero payment records for
 * 
 * Note: This script searches for Xero payment records where the payment_id
 * is stored in the staging_metadata JSONB field.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkSpecificXeroPayments(paymentIds) {
  console.log(`🔍 Checking for specific Xero payments: ${paymentIds.join(', ')}`)
  
  try {
    for (const paymentId of paymentIds) {
      console.log(`\n🔍 Checking for payment ID: ${paymentId}`)
      
      // Check by payment_id in staging_metadata
      const { data: xeroPayments, error } = await supabase
        .from('xero_payments')
        .select('*')
        .eq('staging_metadata->>payment_id', paymentId)
      
      if (error) {
        console.error(`❌ Error checking for payment ${paymentId}:`, error)
        continue
      }
      
      console.log(`Found ${xeroPayments.length} Xero payments for payment ID ${paymentId}:`)
      
      if (xeroPayments.length === 0) {
        console.log(`❌ No Xero payment found for payment ID ${paymentId}`)
      } else {
        xeroPayments.forEach((xeroPayment, i) => {
          console.log(`${i+1}. Xero Payment ID: ${xeroPayment.id}`)
          console.log(`   Amount: $${(xeroPayment.amount_paid / 100).toFixed(2)}`)
          console.log(`   Sync Status: ${xeroPayment.sync_status}`)
          console.log(`   Xero Invoice ID: ${xeroPayment.xero_invoice_id}`)
          console.log(`   Reference: ${xeroPayment.reference}`)
          console.log(`   Staging Metadata:`, JSON.stringify(xeroPayment.staging_metadata, null, 2))
          console.log('')
        })
      }
    }
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const paymentIds = process.argv.slice(2)
if (paymentIds.length === 0) {
  console.error('❌ Please provide payment IDs')
  console.log('Usage: node scripts/debug/check-specific-xero-payments.js <payment_id1> <payment_id2> ...')
  process.exit(1)
}

checkSpecificXeroPayments(paymentIds) 