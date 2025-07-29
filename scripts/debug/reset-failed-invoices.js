/**
 * Debug script to reset failed Xero invoices to pending status for a specific user
 * 
 * This script finds all failed Xero invoices for a user and resets them to
 * 'pending' status so they can be retried. It's useful for:
 * 
 * - Resetting failed invoices that should be retried
 * - Clearing sync errors after fixing underlying issues
 * - Allowing the sync process to retry failed operations
 * - Debugging and fixing Xero sync issues
 * 
 * Usage: node scripts/debug/reset-failed-invoices.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to reset failed invoices for
 * 
 * Note: This script resets failed invoices to 'pending' status and clears
 * their error messages. They will be retried in the next sync run.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function resetFailedInvoices(userId) {
  console.log(`🔄 Resetting failed invoices for user: ${userId}`)
  
  try {
    // Get failed invoices for this user
    const { data: failedInvoices, error: fetchError } = await supabase
      .from('xero_invoices')
      .select('id, sync_error, net_amount, payment_id')
      .eq('staging_metadata->>user_id', userId)
      .eq('sync_status', 'failed')
    
    if (fetchError) {
      console.error('❌ Error fetching failed invoices:', fetchError)
      return
    }
    
    if (failedInvoices.length === 0) {
      console.log('✅ No failed invoices found')
      return
    }
    
    console.log(`📄 Found ${failedInvoices.length} failed invoices:`)
    failedInvoices.forEach((invoice, i) => {
      console.log(`${i+1}. ID: ${invoice.id}`)
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Payment ID: ${invoice.payment_id}`)
      console.log(`   Error: ${invoice.sync_error}`)
    })
    
    // Reset them to pending status
    const invoiceIds = failedInvoices.map(invoice => invoice.id)
    const { error: updateError } = await supabase
      .from('xero_invoices')
      .update({ 
        sync_status: 'pending',
        sync_error: null,
        updated_at: new Date().toISOString()
      })
      .in('id', invoiceIds)
    
    if (updateError) {
      console.error('❌ Error resetting invoices:', updateError)
      return
    }
    
    console.log(`\n✅ Successfully reset ${failedInvoices.length} invoices to pending status`)
    console.log('🔄 These invoices will be retried in the next sync run')
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/reset-failed-invoices.js <user_id>')
  process.exit(1)
}

resetFailedInvoices(userId) 