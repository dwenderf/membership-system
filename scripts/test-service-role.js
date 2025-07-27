#!/usr/bin/env node

/**
 * Service Role Key Test Script
 * 
 * This script tests if the service role key can access the critical tables
 * that the webhook needs to update. This will help identify if the production
 * issue is related to RLS policies or service role key problems.
 */

const { createClient } = require('@supabase/supabase-js')

// Test configuration
const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qojixnzpfkpteakltdoa.supabase.co',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4MzQ2NjEsImV4cCI6MjA2NTQxMDY2MX0.JjLphN6Z-ti65Lsgqsb5y_JtYWnLDH431ZTj7qVTuvM'
}

console.log('🔍 Service Role Key Test\n')

// Check if service role key is available
if (!config.serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment variables')
  console.log('\nTo test with your own keys:')
  console.log('1. Set NEXT_PUBLIC_SUPABASE_URL')
  console.log('2. Set SUPABASE_SERVICE_ROLE_KEY')
  console.log('3. Run: node scripts/test-service-role.js')
  process.exit(1)
}

console.log('✅ Service role key found in environment')
console.log(`📊 Testing against: ${config.supabaseUrl}\n`)

// Create clients
const supabaseService = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const supabaseAnon = createClient(config.supabaseUrl, config.anonKey)

// Test tables that the webhook needs to access
const testTables = [
  'payments',
  'user_memberships', 
  'user_registrations',
  'xero_invoices',
  'xero_payments'
]

async function testTableAccess() {
  console.log('🧪 Testing table access...\n')
  
  for (const tableName of testTables) {
    console.log(`📊 Testing ${tableName}:`)
    
    try {
      // Test with service role (should work)
      const { data: serviceData, error: serviceError, count: serviceCount } = await supabaseService
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .limit(1)
      
      if (serviceError) {
        console.log(`   ❌ Service role failed: ${serviceError.message}`)
      } else {
        console.log(`   ✅ Service role: ${serviceCount || 0} records accessible`)
      }
      
      // Test with anon key (should fail for admin-only tables)
      const { data: anonData, error: anonError, count: anonCount } = await supabaseAnon
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .limit(1)
      
      if (anonError) {
        console.log(`   🔒 Anon key blocked: ${anonError.message}`)
      } else {
        console.log(`   ⚠️  Anon key accessible: ${anonCount || 0} records (unexpected for admin tables)`)
      }
      
    } catch (error) {
      console.log(`   💥 Unexpected error: ${error.message}`)
    }
    
    console.log('')
  }
}

async function testWriteAccess() {
  console.log('✏️  Testing write access to critical tables...\n')
  
  const testTables = ['xero_invoices', 'xero_payments']
  
  for (const tableName of testTables) {
    console.log(`📝 Testing write to ${tableName}:`)
    
    try {
      // Try to insert a test record (will be cleaned up)
      const testData = {
        sync_status: 'test',
        staging_metadata: { test: true, timestamp: new Date().toISOString() }
      }
      
      const { data, error } = await supabaseService
        .from(tableName)
        .insert(testData)
        .select()
      
      if (error) {
        console.log(`   ❌ Write failed: ${error.message}`)
      } else {
        console.log(`   ✅ Write successful: ${data?.length || 0} records inserted`)
        
        // Clean up test data
        if (data && data.length > 0) {
          const { error: deleteError } = await supabaseService
            .from(tableName)
            .delete()
            .in('id', data.map(d => d.id))
          
          if (deleteError) {
            console.log(`   ⚠️  Cleanup failed: ${deleteError.message}`)
          } else {
            console.log(`   🧹 Test data cleaned up`)
          }
        }
      }
      
    } catch (error) {
      console.log(`   💥 Unexpected error: ${error.message}`)
    }
    
    console.log('')
  }
}

async function runTests() {
  try {
    await testTableAccess()
    await testWriteAccess()
    
    console.log('✨ Service role key test complete!')
    console.log('\n📋 Summary:')
    console.log('• If service role tests pass: The key is working correctly')
    console.log('• If service role tests fail: Check SUPABASE_SERVICE_ROLE_KEY in production')
    console.log('• If anon key tests pass for admin tables: RLS policies may be misconfigured')
    
  } catch (error) {
    console.error('💥 Test failed:', error)
  }
}

runTests() 