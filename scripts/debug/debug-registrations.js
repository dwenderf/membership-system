const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://qojixnzpfkpteakltdoa.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTgzNDY2MSwiZXhwIjoyMDY1NDEwNjYxfQ.tRXgXrq3Pc9X5bMH6sYnAnH6pKEK2osz-tLJd33FnH8'

const supabase = createClient(supabaseUrl, supabaseKey)

async function debugRegistrations() {
  console.log('🔍 Debugging registration count issue...\n')
  
  // 1. Check user_registrations table structure and data
  console.log('1. USER_REGISTRATIONS TABLE:')
  const { data: userRegs, error: userRegsError } = await supabase
    .from('user_registrations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (userRegsError) {
    console.error('Error fetching user_registrations:', userRegsError)
  } else {
    console.log('Sample user_registrations data:')
    console.log(JSON.stringify(userRegs, null, 2))
  }
  
  // 2. Check registration_categories
  console.log('\n2. REGISTRATION_CATEGORIES TABLE:')
  const { data: regCats, error: regCatsError } = await supabase
    .from('registration_categories')
    .select('id, max_capacity, registration_id')
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (regCatsError) {
    console.error('Error fetching registration_categories:', regCatsError)
  } else {
    console.log('Sample registration_categories data:')
    console.log(JSON.stringify(regCats, null, 2))
  }
  
  // 3. Check paid registrations count by category
  console.log('\n3. PAID REGISTRATIONS COUNT BY CATEGORY:')
  if (regCats && regCats.length > 0) {
    for (const category of regCats) {
      const { count } = await supabase
        .from('user_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('registration_category_id', category.id)
        .eq('payment_status', 'paid')
      
      console.log(`Category ${category.id}: ${count} paid registrations (max capacity: ${category.max_capacity})`)
    }
  }
  
  // 4. Check for any registration with registration_category_id that has paid status
  console.log('\n4. PAID REGISTRATIONS BREAKDOWN:')
  const { data: paidRegs, error: paidRegsError } = await supabase
    .from('user_registrations')
    .select(`
      id,
      registration_category_id,
      payment_status,
      created_at,
      registered_at
    `)
    .eq('payment_status', 'paid')
  
  if (paidRegsError) {
    console.error('Error fetching paid registrations:', paidRegsError)
  } else {
    console.log('All paid registrations:')
    console.log(JSON.stringify(paidRegs, null, 2))
  }
  
  // 5. Check for specific category with 80 max capacity
  console.log('\n5. CATEGORIES WITH 80 MAX CAPACITY:')
  const { data: cat80, error: cat80Error } = await supabase
    .from('registration_categories')
    .select('*')
    .eq('max_capacity', 80)
  
  if (cat80Error) {
    console.error('Error fetching categories with 80 capacity:', cat80Error)
  } else {
    console.log('Categories with 80 max capacity:')
    console.log(JSON.stringify(cat80, null, 2))
    
    // Check paid count for each category with 80 capacity
    for (const category of cat80 || []) {
      const { count } = await supabase
        .from('user_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('registration_category_id', category.id)
        .eq('payment_status', 'paid')
      
      console.log(`\nCategory ${category.id} (${category.custom_name || 'No custom name'}):`)
      console.log(`  - Max capacity: ${category.max_capacity}`)
      console.log(`  - Current paid count: ${count}`)
      console.log(`  - Spots remaining: ${category.max_capacity - (count || 0)}`)
    }
  }
}

debugRegistrations().catch(console.error)