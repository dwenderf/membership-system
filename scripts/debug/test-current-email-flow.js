require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

async function testCurrentEmailFlow() {
  console.log('🧪 Testing current email flow...')
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  
  try {
    // 1. Check if there are any pending emails
    console.log('\n1️⃣ Checking for pending emails...')
    const { data: pendingEmails, error: pendingError } = await supabase
      .from('email_logs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    
    if (pendingError) {
      console.error('❌ Error fetching pending emails:', pendingError)
      return
    }
    
    console.log(`📧 Found ${pendingEmails?.length || 0} pending emails`)
    
    if (pendingEmails && pendingEmails.length > 0) {
      console.log('📋 Pending emails:')
      pendingEmails.forEach((email, index) => {
        console.log(`  ${index + 1}. ID: ${email.id}, Event: ${email.event_type}, User: ${email.user_id}, Created: ${email.created_at}`)
      })
      
      // 2. Test the email staging manager directly
      console.log('\n2️⃣ Testing email staging manager...')
      
      // Import the email staging manager
      const { EmailStagingManager } = require('../../src/lib/email/staging')
      const emailStagingManager = new EmailStagingManager()
      
      const results = await emailStagingManager.processStagedEmails()
      
      console.log('📊 Email processing results:', {
        processed: results.processed,
        successful: results.successful,
        failed: results.failed,
        errors: results.errors
      })
      
      // 3. Check if emails were processed
      console.log('\n3️⃣ Checking if emails were processed...')
      const { data: updatedEmails, error: updatedError } = await supabase
        .from('email_logs')
        .select('*')
        .in('id', pendingEmails.map(e => e.id))
        .order('created_at', { ascending: true })
      
      if (updatedError) {
        console.error('❌ Error fetching updated emails:', updatedError)
        return
      }
      
      console.log('📋 Updated emails:')
      updatedEmails.forEach((email, index) => {
        console.log(`  ${index + 1}. ID: ${email.id}, Status: ${email.status}, Sent: ${email.sent_at || 'Not sent'}`)
      })
      
    } else {
      console.log('✅ No pending emails found - this is good!')
    }
    
    // 4. Check recent email logs to see the pattern
    console.log('\n4️⃣ Checking recent email logs...')
    const { data: recentEmails, error: recentError } = await supabase
      .from('email_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (recentError) {
      console.error('❌ Error fetching recent emails:', recentError)
      return
    }
    
    console.log('📋 Recent email logs:')
    recentEmails.forEach((email, index) => {
      console.log(`  ${index + 1}. ID: ${email.id}, Status: ${email.status}, Event: ${email.event_type}, Created: ${email.created_at}, Sent: ${email.sent_at || 'Not sent'}`)
    })
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

testCurrentEmailFlow()
  .then(() => {
    console.log('\n✅ Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }) 