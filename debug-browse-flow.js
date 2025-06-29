const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://qojixnzpfkpteakltdoa.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaml4bnpwZmtwdGVha2x0ZG9hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTgzNDY2MSwiZXhwIjoyMDY1NDEwNjYxfQ.tRXgXrq3Pc9X5bMH6sYnAnH6pKEK2osz-tLJd33FnH8'

const supabase = createClient(supabaseUrl, supabaseKey)

async function debugBrowseFlow() {
  console.log('🔍 Simulating browse registrations page flow...\n')
  
  // Step 1: Get current/future seasons (same as browse page)
  console.log('1. Getting current/future seasons...')
  const { data: currentSeasons } = await supabase
    .from('seasons')
    .select('id')
    .gte('end_date', new Date().toISOString().split('T')[0])
  
  console.log('Current seasons:', currentSeasons)
  const seasonIds = currentSeasons?.map(s => s.id) || []
  
  // Step 2: Get available registrations (same as browse page)
  console.log('\n2. Getting available registrations...')
  const { data: availableRegistrations } = await supabase
    .from('registrations')
    .select(`
      *,
      season:seasons(*),
      registration_categories(
        *,
        categories:category_id(name),
        memberships:required_membership_id(name)
      )
    `)
    .in('season_id', seasonIds)
    .order('created_at', { ascending: false })
  
  console.log('Available registrations found:', availableRegistrations?.length || 0)
  
  // Step 3: Get paid registration counts for all categories (EXACT same logic as browse page)
  console.log('\n3. Calculating paid registration counts...')
  const categoryRegistrationCounts = {}
  
  if (availableRegistrations) {
    for (const registration of availableRegistrations) {
      console.log(`\nProcessing registration: ${registration.name}`)
      if (registration.registration_categories) {
        for (const category of registration.registration_categories) {
          console.log(`  Checking category: ${category.id} (max: ${category.max_capacity})`)
          
          const { count } = await supabase
            .from('user_registrations')
            .select('*', { count: 'exact', head: true })
            .eq('registration_category_id', category.id)
            .eq('payment_status', 'paid')
          
          categoryRegistrationCounts[category.id] = count || 0
          console.log(`    Paid count: ${count}`)
          
          if (category.max_capacity) {
            const remaining = category.max_capacity - (count || 0)
            console.log(`    Spots remaining: ${remaining}`)
          }
        }
      }
    }
  }
  
  console.log('\n4. Final categoryRegistrationCounts object:')
  console.log(JSON.stringify(categoryRegistrationCounts, null, 2))
  
  // Step 4: Show how this data would be passed to RegistrationPurchase component
  console.log('\n5. Data passed to RegistrationPurchase component:')
  if (availableRegistrations) {
    for (const registration of availableRegistrations) {
      if (registration.registration_categories) {
        for (const category of registration.registration_categories) {
          const enhancedCategory = {
            ...category,
            current_count: categoryRegistrationCounts[category.id] || 0
          }
          
          if (category.max_capacity) {
            const remaining = category.max_capacity - enhancedCategory.current_count
            console.log(`Category ${category.id}:`)
            console.log(`  - max_capacity: ${category.max_capacity}`)
            console.log(`  - current_count: ${enhancedCategory.current_count}`)
            console.log(`  - calculated remaining: ${remaining}`)
          }
        }
      }
    }
  }
}

debugBrowseFlow().catch(console.error)