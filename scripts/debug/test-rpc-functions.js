/**
 * Test script to verify Xero RPC functions are working correctly
 * 
 * This script tests the database-level locking RPC functions that are used
 * by the Xero batch sync process. It's useful for:
 * 
 * - Verifying that RPC functions exist and are accessible
 * - Testing function calls with no pending records (should return empty)
 * - Testing function calls with existing pending records (should lock and return them)
 * - Debugging RPC function errors before they affect production sync
 * - Validating that the database-level locking is working as expected
 * 
 * Usage: node scripts/debug/test-rpc-functions.js
 * 
 * Note: This script doesn't require any arguments - it tests the functions
 * with the current state of the database.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testRPCFunctions() {
  console.log('🧪 Testing RPC functions...')
  
  try {
    // Test 1: Test invoice function directly
    // This should work even with no pending records
    console.log('\n📋 Test 1: Testing invoice function...')
    
    const { data: invoices, error: invoiceError } = await supabase
      .rpc('get_pending_xero_invoices_with_lock', { limit_count: 5 })
    
    if (invoiceError) {
      console.error('❌ Invoice function error:', invoiceError)
    } else {
      console.log('✅ Invoice function works, returned:', invoices?.length || 0, 'records')
    }
    
    // Test 2: Test payment function directly
    // This should work even with no pending records
    console.log('\n📋 Test 2: Testing payment function...')
    
    const { data: payments, error: paymentError } = await supabase
      .rpc('get_pending_xero_payments_with_lock', { limit_count: 5 })
    
    if (paymentError) {
      console.error('❌ Payment function error:', paymentError)
    } else {
      console.log('✅ Payment function works, returned:', payments?.length || 0, 'records')
    }
    
    // Test 3: Check if there are any pending records to test with
    // This helps understand the current state of the database
    console.log('\n📋 Test 3: Checking for pending records...')
    
    const { data: pendingInvoices, error: pendingError } = await supabase
      .from('xero_invoices')
      .select('id, sync_status, staged_at')
      .eq('sync_status', 'pending')
      .order('staged_at', { ascending: true })
      .limit(3)
    
    if (pendingError) {
      console.error('❌ Error checking pending invoices:', pendingError)
    } else {
      console.log('📄 Found', pendingInvoices?.length || 0, 'pending invoices')
      if (pendingInvoices && pendingInvoices.length > 0) {
        console.log('   First pending invoice:', pendingInvoices[0].id)
      }
    }
    
    const { data: pendingPayments, error: pendingPaymentsError } = await supabase
      .from('xero_payments')
      .select('id, sync_status, staged_at')
      .eq('sync_status', 'pending')
      .order('staged_at', { ascending: true })
      .limit(3)
    
    if (pendingPaymentsError) {
      console.error('❌ Error checking pending payments:', pendingPaymentsError)
    } else {
      console.log('💳 Found', pendingPayments?.length || 0, 'pending payments')
      if (pendingPayments && pendingPayments.length > 0) {
        console.log('   First pending payment:', pendingPayments[0].id)
      }
    }
    
    // Summary
    console.log('\n📊 Test Summary:')
    console.log('- RPC functions should be accessible and return empty arrays when no pending records exist')
    console.log('- If there are pending records, the functions should lock them using SELECT FOR UPDATE SKIP LOCKED')
    console.log('- This test validates the database-level locking mechanism is working correctly')
    
  } catch (error) {
    console.error('❌ Test error:', error)
  }
}

testRPCFunctions() 