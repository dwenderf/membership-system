/**
 * Script to provide step-by-step instructions for cleaning up Xero invoices
 * 
 * This script analyzes the current state and provides clear instructions
 * for what needs to be done in Xero to fix the invoice/payment issues.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function generateCleanupInstructions(userId) {
  console.log(`📋 Xero Cleanup Instructions for user: ${userId}`)
  console.log('=' .repeat(60))
  
  try {
    // Get user details
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
    console.log('')
    
    // Get all Xero invoices for this user
    const { data: xeroInvoices, error: invoicesError } = await supabase
      .from('xero_invoices')
      .select('*')
      .eq('staging_metadata->>user_id', userId)
      .order('created_at', { ascending: false })
    
    if (invoicesError) {
      console.error('❌ Error fetching Xero invoices:', invoicesError)
      return
    }
    
    // Find the problematic invoices (INV-6903, INV-6904)
    const problematicInvoices = xeroInvoices.filter(invoice => 
      invoice.invoice_number === 'INV-6903' || invoice.invoice_number === 'INV-6904'
    )
    
    // Find the correct invoices that should be synced
    const correctInvoices = xeroInvoices.filter(invoice => 
      invoice.sync_status === 'failed' || invoice.sync_status === 'pending'
    )
    
    console.log('🚨 PROBLEMATIC INVOICES IN XERO (need cleanup):')
    console.log('')
    
    problematicInvoices.forEach((invoice, i) => {
      console.log(`${i+1}. ${invoice.invoice_number} (${invoice.xero_invoice_id})`)
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Status: ${invoice.invoice_status}`)
      console.log(`   Issue: Wrong amount - should be different`)
      console.log('')
    })
    
    console.log('✅ CORRECT INVOICES (should be synced):')
    console.log('')
    
    correctInvoices.forEach((invoice, i) => {
      console.log(`${i+1}. Invoice ID: ${invoice.id}`)
      console.log(`   Amount: $${(invoice.net_amount / 100).toFixed(2)}`)
      console.log(`   Payment ID: ${invoice.payment_id}`)
      console.log(`   Sync Status: ${invoice.sync_status}`)
      console.log('')
    })
    
    console.log('📝 STEP-BY-STEP CLEANUP INSTRUCTIONS:')
    console.log('')
    console.log('1. 🗑️  IN XERO - Remove payments from wrong invoices:')
    problematicInvoices.forEach((invoice) => {
      console.log(`   • Go to ${invoice.invoice_number} (${invoice.xero_invoice_id})`)
      console.log(`   • Remove any payments attached to this invoice`)
      console.log(`   • Note: These payments are invalid anyway (wrong amounts)`)
    })
    console.log('')
    
    console.log('2. ❌ IN XERO - Void the wrong invoices:')
    problematicInvoices.forEach((invoice) => {
      console.log(`   • Void ${invoice.invoice_number} (${invoice.xero_invoice_id})`)
      console.log(`   • This will remove it from financial reporting`)
    })
    console.log('')
    
    console.log('3. 🔄 IN OUR SYSTEM - Reset failed invoices:')
    console.log(`   • Run: node scripts/debug/reset-failed-invoices.js ${userId}`)
    console.log('')
    
    console.log('4. 🔄 RUN XERO SYNC:')
    console.log('   • Go to admin/accounting page')
    console.log('   • Click "Manual Sync" or wait for cron job')
    console.log('   • This will create new, correct invoices')
    console.log('')
    
    console.log('5. ✅ VERIFY RESULTS:')
    console.log(`   • Run: node scripts/debug/debug-user-xero-records.js ${userId}`)
    console.log('   • Check that new invoices have correct amounts')
    console.log('   • Verify payments are linked correctly')
    console.log('')
    
    console.log('⚠️  IMPORTANT NOTES:')
    console.log('• The old invoices (INV-6903, INV-6904) have wrong amounts')
    console.log('• The payments on them are invalid and should be removed')
    console.log('• After cleanup, new invoices will be created with correct amounts')
    console.log('• This will fix the financial reporting accuracy')
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

const userId = process.argv[2]
if (!userId) {
  console.error('❌ Please provide a user ID')
  console.log('Usage: node scripts/debug/xero-cleanup-instructions.js <user_id>')
  process.exit(1)
}

generateCleanupInstructions(userId) 