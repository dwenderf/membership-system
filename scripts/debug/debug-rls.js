const { createClient } = require('@supabase/supabase-js')

// Test with service role key (should work)
const supabaseService = createClient(
  'https://qojixnzpfkpteakltdoa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTgzNDY2MSwiZXhwIjoyMDY1NDEwNjYxfQ.tRXgXrq3Pc9X5bMH6sYnAnH6pKEK2osz-tLJd33FnH8'
)

// Test with anon key (what the frontend uses)
const supabaseAnon = createClient(
  'https://qojixnzpfkpteakltdoa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4MzQ2NjEsImV4cCI6MjA2NTQxMDY2MX0.JjLphN6Z-ti65Lsgqsb5y_JtYWnLDH431ZTj7qVTuvM'
)

async function testRLS() {
  console.log('🔍 Testing RLS policies...\n')
  
  const categoryId = 'd7363f23-0fb5-4c9a-bf5c-1d9061ad7929'
  
  console.log('1. Testing with SERVICE ROLE key (bypasses RLS):')
  const { count: serviceCount, error: serviceError } = await supabaseService
    .from('user_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('registration_category_id', categoryId)
    .eq('payment_status', 'paid')
  
  if (serviceError) {
    console.error('Service role error:', serviceError)
  } else {
    console.log(`Service role count: ${serviceCount}`)
  }
  
  console.log('\n2. Testing with ANON key (subject to RLS):')
  const { count: anonCount, error: anonError } = await supabaseAnon
    .from('user_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('registration_category_id', categoryId)
    .eq('payment_status', 'paid')
  
  if (anonError) {
    console.error('Anon key error:', anonError)
  } else {
    console.log(`Anon key count: ${anonCount}`)
  }
  
  console.log('\n3. Testing anon access to individual records:')
  const { data: anonData, error: anonDataError } = await supabaseAnon
    .from('user_registrations')
    .select('*')
    .eq('registration_category_id', categoryId)
    .eq('payment_status', 'paid')
  
  if (anonDataError) {
    console.error('Anon data error:', anonDataError)
  } else {
    console.log(`Anon data records found: ${anonData?.length || 0}`)
    console.log('Anon data:', JSON.stringify(anonData, null, 2))
  }
  
  // Check if there's a specific user logged in affecting RLS
  console.log('\n4. Checking current user status for anon client:')
  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser()
  if (userError) {
    console.log('No user logged in (expected for anon key)')
  } else {
    console.log('User logged in:', user)
  }
}

testRLS().catch(console.error)