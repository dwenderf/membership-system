/**
 * Test script to verify actual Loops email sending functionality
 * 
 * This script properly loads environment variables and tests the actual
 * email sending via Loops.so to ensure it's working correctly.
 * 
 * Usage: node scripts/debug/test-loops-email.js <userId>
 * Example: node scripts/debug/test-loops-email.js de8d93d4-0165-4edc-be37-81e038e2abf1
 */

const { createClient } = require('@supabase/supabase-js')
const { LoopsClient } = require('loops')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testLoopsEmail() {
  console.log('🧪 Testing actual Loops email sending...')
  
  try {
    // Get userId from command line arguments
    const userId = process.argv[2]
    
    if (!userId) {
      console.error('❌ Please provide a userId as an argument')
      console.error('Usage: node scripts/debug/test-loops-email.js <userId>')
      console.error('Example: node scripts/debug/test-loops-email.js de8d93d4-0165-4edc-be37-81e038e2abf1')
      process.exit(1)
    }
    
    console.log(`👤 Testing with userId: ${userId}`)
    
    // Look up user information from the database
    console.log('🔍 Looking up user information...')
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name')
      .eq('id', userId)
      .single()
    
    if (userError || !user) {
      console.error('❌ Error fetching user:', userError)
      console.error('User not found or error occurred')
      process.exit(1)
    }
    
    const userEmail = user.email
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User'
    
    console.log(`✅ Found user: ${userName} (${userEmail})`)
    
    // Check if Loops API key is configured
    const loopsApiKey = process.env.LOOPS_API_KEY
    console.log(`🔑 Loops API Key configured: ${loopsApiKey ? 'Yes' : 'No'}`)
    
    if (!loopsApiKey || loopsApiKey === 'your_loops_api_key') {
      console.error('❌ Loops API key not properly configured')
      return
    }
    
    // Check template IDs
    const membershipTemplateId = process.env.LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID
    console.log(`📧 Membership template ID: ${membershipTemplateId}`)
    
    // Create Loops client
    console.log('📦 Creating Loops client...')
    const loops = new LoopsClient(loopsApiKey)
    
    // Test sending a membership confirmation email
    console.log('📧 Sending test membership confirmation email...')
    
    const emailData = {
      userName: userName,
      membershipName: 'Full Hockey Membership - Skater',
      amount: '700.00',
      durationMonths: 12,
      validFrom: '2025-07-30',
      validUntil: '2026-07-30',
      paymentIntentId: 'pi_test_' + Date.now(),
      purchaseDate: new Date().toLocaleDateString(),
      dashboardUrl: 'https://hockeyassociation.org/user/dashboard'
    }
    
    console.log('📧 Email data:', emailData)
    
    const loopsResponse = await loops.sendTransactionalEmail({
      transactionalId: membershipTemplateId,
      email: userEmail,
      dataVariables: emailData
    })
    
    console.log('📊 Loops response:', loopsResponse)
    
    if (loopsResponse && 'success' in loopsResponse && loopsResponse.success) {
      console.log('✅ Email sent successfully via Loops!')
      console.log(`📧 Loops event ID: ${loopsResponse.id || 'N/A'}`)
      
      // Log the email to the database
      console.log('📝 Logging email to database...')
      const { error: logError } = await supabase
        .from('email_logs')
        .insert({
          user_id: userId,
          email_address: userEmail,
          event_type: 'membership.purchased',
          subject: 'Membership Confirmation - Full Hockey Membership - Skater',
          template_id: membershipTemplateId,
          status: 'delivered',
          loops_event_id: loopsResponse.id || 'sent',
          triggered_by: 'admin_send',
          email_data: emailData
        })
      
      if (logError) {
        console.error('❌ Error logging email to database:', logError)
      } else {
        console.log('✅ Email logged to database successfully')
      }
      
    } else {
      console.error('❌ Email sending failed via Loops')
      console.error('Response:', loopsResponse)
    }
    
    console.log('\n✅ Loops email test completed!')
    
  } catch (error) {
    console.error('❌ Error testing Loops email:', error)
    
    // Log more details about the error
    if (error.response) {
      console.error('Response status:', error.response.status)
      console.error('Response data:', error.response.data)
    }
  }
}

// Run the test
testLoopsEmail()
  .then(() => {
    console.log('🏁 Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Test failed:', error)
    process.exit(1)
  }) 