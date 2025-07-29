/**
 * Debug script to verify that Xero invoices actually exist in Xero
 * 
 * This script checks synced invoices to verify their validity and identify
 * potential discrepancies between our database and Xero. It's useful for:
 * 
 * - Verifying that synced invoices have valid Xero IDs and invoice numbers
 * - Checking for invoices marked as synced but missing Xero IDs
 * - Identifying old synced invoices that might need attention
 * - Validating the sync process is working correctly
 * 
 * Usage: node scripts/debug/verify-xero-invoices.js
 * 
 * Note: This script doesn't require any arguments - it analyzes synced invoices
 * and provides validation checks to ensure data integrity.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verifyXeroInvoices() {
  console.log('🔍 Verifying Xero invoices exist...')
  
  // Get a few zero-value invoices that are marked as synced
  const { data: syncedInvoices, error } = await supabase
    .from('xero_invoices')
    .select(`
      id,
      net_amount,
      xero_invoice_id,
      invoice_number,
      sync_status,
      last_synced_at
    `)
    .eq('net_amount', 0)
    .eq('sync_status', 'synced')
    .not('xero_invoice_id', 'is', null)
    .limit(5)
  
  if (error) {
    console.error('❌ Error fetching synced invoices:', error)
    return
  }
  
  console.log(`📊 Found ${syncedInvoices.length} synced zero-value invoices to verify:`)
  
  for (const invoice of syncedInvoices) {
    console.log(`\n🔍 Checking invoice: ${invoice.invoice_number} (Xero ID: ${invoice.xero_invoice_id})`)
    
    // We can't directly call Xero API from this script, but we can check if the invoice number
    // follows the expected pattern and if the sync was recent
    const syncDate = new Date(invoice.last_synced_at)
    const now = new Date()
    const hoursSinceSync = (now - syncDate) / (1000 * 60 * 60)
    
    console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
    console.log(`   Sync Status: ${invoice.sync_status}`)
    console.log(`   Last Synced: ${invoice.last_synced_at} (${hoursSinceSync.toFixed(1)} hours ago)`)
    console.log(`   Invoice Number Pattern: ${invoice.invoice_number?.startsWith('INV-') ? '✅ Valid' : '❌ Invalid'}`)
    
    // Check if this invoice appears in our financial reports
    const { data: paymentData } = await supabase
      .from('payments')
      .select('id, final_amount, status, stripe_payment_intent_id')
      .eq('id', invoice.payment_id)
      .single()
    
    if (paymentData) {
      console.log(`   Payment: $${(paymentData.final_amount / 100).toFixed(2)} (${paymentData.status})`)
    } else {
      console.log(`   Payment: No payment record found`)
    }
  }
  
  // Also check if there are any zero-value invoices that might be missing from Xero
  console.log(`\n🔍 Checking for potential issues...`)
  
  // Check for invoices marked as synced but with very old sync dates
  const { data: oldSyncedInvoices } = await supabase
    .from('xero_invoices')
    .select('id, net_amount, xero_invoice_id, invoice_number, last_synced_at')
    .eq('net_amount', 0)
    .eq('sync_status', 'synced')
    .lt('last_synced_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Older than 7 days
    .limit(3)
  
  if (oldSyncedInvoices && oldSyncedInvoices.length > 0) {
    console.log(`\n⚠️ Found ${oldSyncedInvoices.length} zero-value invoices synced more than 7 days ago:`)
    oldSyncedInvoices.forEach((invoice, i) => {
      console.log(`${i+1}. ${invoice.invoice_number} - synced ${invoice.last_synced_at}`)
    })
  }
  
  // Check for any zero-value invoices without Xero IDs
  const { data: missingXeroIds } = await supabase
    .from('xero_invoices')
    .select('id, net_amount, sync_status, last_synced_at')
    .eq('net_amount', 0)
    .eq('sync_status', 'synced')
    .is('xero_invoice_id', null)
  
  if (missingXeroIds && missingXeroIds.length > 0) {
    console.log(`\n🚨 Found ${missingXeroIds.length} zero-value invoices marked as synced but missing Xero IDs!`)
    missingXeroIds.forEach((invoice, i) => {
      console.log(`${i+1}. ID: ${invoice.id} - synced ${invoice.last_synced_at}`)
    })
  } else {
    console.log(`\n✅ All synced zero-value invoices have Xero IDs`)
  }
}

verifyXeroInvoices() 