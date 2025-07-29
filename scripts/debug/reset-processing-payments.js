/**
 * Debug script to reset Xero payment records from 'processing' to 'pending' status
 * 
 * This script fixes payment records that got stuck in 'processing' status
 * due to the old RPC function logic. It's useful for:
 * 
 * - Resetting payment records that are stuck in 'processing' status
 * - Making payment records visible in the admin UI for manual sync
 * - Fixing issues where payments don't appear in the admin accounting page
 * - Ensuring payment records can be properly synced to Xero
 * 
 * Usage: node scripts/debug/reset-processing-payments.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to reset processing payments for
 * 
 * Note: This script is needed when the old RPC functions were setting records
 * to 'processing' status. The new RPC functions don't change status, so this
 * script should not be needed for new records.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function resetProcessingPayments(userId) {
  console.log(`🔄 Resetting processing Xero payments for user: ${userId}`)
  
  // Find all processing payments for this user
  const { data: processingPayments, error } = await supabase
    .from('xero_payments')
    .select('id, amount_paid, sync_status, staging_metadata')
    .eq('staging_metadata->>user_id', userId)
    .eq('sync_status', 'processing')
  
  if (error) {
    console.error('❌ Error fetching processing payments:', error)
    return
  }
  
  console.log(`📋 Found ${processingPayments.length} processing payments:`)
  processingPayments.forEach((payment, i) => {
    console.log(`${i+1}. ID: ${payment.id}`)
    console.log(`   Amount: $${(payment.amount_paid / 100).toFixed(2)}`)
    console.log(`   Status: ${payment.sync_status}`)
    console.log(`   Payment ID: ${payment.staging_metadata?.payment_id}`)
    console.log('')
  })
  
  if (processingPayments.length === 0) {
    console.log('✅ No processing payments found to reset')
    return
  }
  
  // Reset them to pending
  const paymentIds = processingPayments.map(p => p.id)
  const { error: updateError } = await supabase
    .from('xero_payments')
    .update({ 
      sync_status: 'pending',
      updated_at: new Date().toISOString()
    })
    .in('id', paymentIds)
  
  if (updateError) {
    console.error('❌ Error resetting payments to pending:', updateError)
    return
  }
  
  console.log(`✅ Successfully reset ${processingPayments.length} payments from 'processing' to 'pending'`)
  console.log('🔄 These payments should now appear in the admin UI for manual sync')
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/reset-processing-payments.js <user_id>')
  process.exit(1)
}

resetProcessingPayments(userId) 