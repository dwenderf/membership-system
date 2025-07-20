const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://qojixnzpfkpteakltdoa.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTgzNDY2MSwiZXhwIjoyMDY1NDEwNjYxfQ.tRXgXrq3Pc9X5bMH6sYnAnH6pKEK2osz-tLJd33FnH8'

const supabase = createClient(supabaseUrl, supabaseKey)

async function applyRLSFix() {
  console.log('🔧 Applying RLS fix for registration counting...\n')
  
  try {
    // Add the public policy for counting paid registrations
    const { error } = await supabase.rpc('sql', {
      query: `
        CREATE POLICY "Anyone can count paid registrations" ON user_registrations
        FOR SELECT USING (payment_status = 'paid');
      `
    })
    
    if (error) {
      console.error('Error applying RLS policy:', error)
    } else {
      console.log('✅ RLS policy applied successfully!')
    }
    
    // Test the fix
    console.log('\n🧪 Testing the fix...')
    
    const supabaseAnon = createClient(
      supabaseUrl,
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4MzQ2NjEsImV4cCI6MjA2NTQxMDY2MX0.JjLphN6Z-ti65Lsgqsb5y_JtYWnLDH431ZTj7qVTuvM'
    )
    
    const { count: testCount, error: testError } = await supabaseAnon
      .from('user_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('registration_category_id', 'd7363f23-0fb5-4c9a-bf5c-1d9061ad7929')
      .eq('payment_status', 'paid')
    
    if (testError) {
      console.error('Test failed:', testError)
    } else {
      console.log(`✅ Test passed! Anon key can now count: ${testCount} paid registrations`)
    }
    
  } catch (err) {
    console.error('Unexpected error:', err)
  }
}

applyRLSFix().catch(console.error)