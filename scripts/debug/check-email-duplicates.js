const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkEmailDuplicates() {
  console.log('🔍 Checking for duplicate emails in email_logs table...')
  
  try {
    // Get all email_logs
    const { data: emails, error } = await supabase
      .from('email_logs')
      .select('user_id, event_type, email_data, created_at, id, email_address')
      .order('user_id, event_type, created_at')
    
    if (error) {
      console.error('❌ Error querying email_logs:', error)
      return
    }
    
    console.log(`📊 Total emails: ${emails.length}`)
    
    // Group by potential duplicate keys
    const grouped = {}
    emails.forEach(email => {
      // Extract payment_id and related_entity_id from email_data JSONB
      const paymentId = email.email_data?.payment_id || 'null'
      const relatedEntityId = email.email_data?.related_entity_id || 'null'
      
      // Create a key that would be used for the unique constraint
      const key = `${email.user_id}-${email.event_type}-${paymentId}-${relatedEntityId}`
      if (!grouped[key]) {
        grouped[key] = []
      }
      grouped[key].push(email)
    })
    
    // Find groups with more than 1 email
    const duplicates = Object.entries(grouped)
      .filter(([key, emails]) => emails.length > 1)
    
    console.log(`\n🔍 Found ${duplicates.length} sets of duplicate emails:`)
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicates found! Safe to add unique constraint.')
      return
    }
    
    duplicates.forEach(([key, emails], index) => {
      console.log(`\n${index + 1}. Duplicate set (${emails.length} emails):`)
      console.log(`   Key: ${key}`)
      emails.forEach((email, emailIndex) => {
        console.log(`   ${emailIndex + 1}. ID: ${email.id}, Email: ${email.email_address}, Created: ${email.created_at}`)
      })
    })
    
    console.log(`\n⚠️  Found ${duplicates.length} duplicate sets. Need to clean up before adding constraint.`)
    
  } catch (error) {
    console.error('❌ Script error:', error)
  }
}

checkEmailDuplicates() 