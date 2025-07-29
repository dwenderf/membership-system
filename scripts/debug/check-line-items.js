/**
 * Debug script to check line items for Xero invoices for a specific user
 * 
 * This script analyzes the line items associated with Xero invoices for a user,
 * showing both the database line items and the staging metadata. It's useful for:
 * 
 * - Understanding how line items are structured in Xero invoices
 * - Debugging issues with line item creation or mapping
 * - Validating that line items match the staging metadata
 * - Checking account codes and amounts for line items
 * 
 * Usage: node scripts/debug/check-line-items.js <user_id>
 * 
 * Arguments:
 * - user_id: The user ID to check line items for
 * 
 * Note: This script shows both the actual line items stored in the database
 * and the staging metadata that was used to create them.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkLineItems(userId) {
  console.log(`🔍 Checking line items for user: ${userId}`)
  
  try {
    // Get all invoices for this user
    const { data: invoices, error: invoicesError } = await supabase
      .from('xero_invoices')
      .select('id, net_amount, sync_status, staging_metadata')
      .eq('staging_metadata->>user_id', userId)
      .order('created_at', { ascending: false })
    
    if (invoicesError) {
      console.error('❌ Error fetching invoices:', invoicesError)
      return
    }
    
    console.log(`📄 Found ${invoices.length} invoices:`)
    
    for (const invoice of invoices) {
      console.log(`\n📄 Invoice ID: ${invoice.id}`)
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Sync Status: ${invoice.sync_status}`)
      
      // Get line items for this invoice
      const { data: lineItems, error: lineItemsError } = await supabase
        .from('xero_invoice_line_items')
        .select('*')
        .eq('xero_invoice_id', invoice.id)
        .order('created_at', { ascending: true })
      
      if (lineItemsError) {
        console.error(`   ❌ Error fetching line items:`, lineItemsError)
        continue
      }
      
      console.log(`   📋 Line Items (${lineItems.length}):`)
      lineItems.forEach((item, i) => {
        console.log(`     ${i+1}. ${item.description}`)
        console.log(`        Amount: $${(item.line_amount / 100).toFixed(2)}`)
        console.log(`        Account Code: ${item.account_code}`)
        console.log(`        Type: ${item.line_item_type}`)
      })
      
      // Check staging metadata
      if (invoice.staging_metadata) {
        console.log(`   📦 Staging Metadata:`)
        console.log(`      Payment Items: ${invoice.staging_metadata.payment_items?.length || 0}`)
        if (invoice.staging_metadata.payment_items) {
          invoice.staging_metadata.payment_items.forEach((item, i) => {
            console.log(`        ${i+1}. ${item.description} - $${(item.amount / 100).toFixed(2)}`)
          })
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/check-line-items.js <user_id>')
  process.exit(1)
}

checkLineItems(userId) 