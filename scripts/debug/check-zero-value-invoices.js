/**
 * Debug script to check zero-value invoices in the system
 * 
 * This script analyzes zero-value invoices to understand their sync status
 * and identify potential issues with Xero integration. It's useful for:
 * 
 * - Identifying zero-value invoices that are marked as synced but missing Xero IDs
 * - Understanding the distribution of sync statuses for zero-value invoices
 * - Debugging issues where zero-value invoices appear in financial reports but not in Xero
 * - Validating that zero-value invoices are being handled correctly
 * 
 * Usage: node scripts/debug/check-zero-value-invoices.js
 * 
 * Note: This script doesn't require any arguments - it analyzes all zero-value invoices
 * in the system and provides a comprehensive status breakdown.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkZeroValueInvoices() {
  console.log('🔍 Checking zero-value invoices...')
  
  // Get all zero-value invoices
  const { data: zeroValueInvoices, error } = await supabase
    .from('xero_invoices')
    .select(`
      id,
      net_amount,
      sync_status,
      xero_invoice_id,
      invoice_number,
      last_synced_at,
      sync_error,
      staging_metadata
    `)
    .eq('net_amount', 0)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('❌ Error fetching zero-value invoices:', error)
    return
  }
  
  console.log(`📊 Found ${zeroValueInvoices.length} zero-value invoices:`)
  
  const syncedCount = zeroValueInvoices.filter(inv => inv.sync_status === 'synced').length
  const pendingCount = zeroValueInvoices.filter(inv => inv.sync_status === 'pending').length
  const failedCount = zeroValueInvoices.filter(inv => inv.sync_status === 'failed').length
  const processingCount = zeroValueInvoices.filter(inv => inv.sync_status === 'processing').length
  
  console.log(`\n📈 Status breakdown:`)
  console.log(`- Synced: ${syncedCount}`)
  console.log(`- Pending: ${pendingCount}`)
  console.log(`- Failed: ${failedCount}`)
  console.log(`- Processing: ${processingCount}`)
  
  // Check for synced invoices without Xero IDs
  const syncedWithoutXeroId = zeroValueInvoices.filter(inv => 
    inv.sync_status === 'synced' && !inv.xero_invoice_id
  )
  
  if (syncedWithoutXeroId.length > 0) {
    console.log(`\n🚨 PROBLEM: Found ${syncedWithoutXeroId.length} zero-value invoices marked as synced but missing Xero IDs:`)
    syncedWithoutXeroId.forEach((invoice, i) => {
      console.log(`${i+1}. Invoice ID: ${invoice.id}`)
      console.log(`   Sync Status: ${invoice.sync_status}`)
      console.log(`   Xero Invoice ID: ${invoice.xero_invoice_id || 'MISSING'}`)
      console.log(`   Invoice Number: ${invoice.invoice_number || 'MISSING'}`)
      console.log(`   Last Synced: ${invoice.last_synced_at}`)
      console.log(`   Sync Error: ${invoice.sync_error || 'None'}`)
      console.log('')
    })
  } else {
    console.log(`\n✅ All synced zero-value invoices have Xero IDs`)
  }
  
  // Show some examples of each status
  console.log(`\n📋 Sample invoices by status:`)
  
  const sampleSynced = zeroValueInvoices.filter(inv => inv.sync_status === 'synced').slice(0, 3)
  if (sampleSynced.length > 0) {
    console.log(`\n✅ Sample synced invoices:`)
    sampleSynced.forEach((invoice, i) => {
      console.log(`${i+1}. ID: ${invoice.id}`)
      console.log(`   Xero ID: ${invoice.xero_invoice_id}`)
      console.log(`   Invoice Number: ${invoice.invoice_number}`)
      console.log(`   Last Synced: ${invoice.last_synced_at}`)
    })
  }
  
  const samplePending = zeroValueInvoices.filter(inv => inv.sync_status === 'pending').slice(0, 3)
  if (samplePending.length > 0) {
    console.log(`\n⏳ Sample pending invoices:`)
    samplePending.forEach((invoice, i) => {
      console.log(`${i+1}. ID: ${invoice.id}`)
      console.log(`   Last Synced: ${invoice.last_synced_at}`)
      console.log(`   Sync Error: ${invoice.sync_error || 'None'}`)
    })
  }
  
  const sampleFailed = zeroValueInvoices.filter(inv => inv.sync_status === 'failed').slice(0, 3)
  if (sampleFailed.length > 0) {
    console.log(`\n❌ Sample failed invoices:`)
    sampleFailed.forEach((invoice, i) => {
      console.log(`${i+1}. ID: ${invoice.id}`)
      console.log(`   Error: ${invoice.sync_error}`)
      console.log(`   Last Synced: ${invoice.last_synced_at}`)
    })
  }
}

checkZeroValueInvoices() 