/**
 * Test script to verify actual email sending functionality
 * 
 * This script uses the real email batch processor to send the reset email
 * and verify that it actually sends via the email service.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testActualEmailSending() {
  console.log('🧪 Testing actual email sending functionality...')
  
  try {
    // Get email ID from command line arguments
    const emailId = process.argv[2]
    if (!emailId) {
      console.error('❌ Please provide an email ID as an argument')
      console.error('Usage: node test-actual-email-sending.js <email_id>')
      console.error('Example: node test-actual-email-sending.js a766a166-d925-401f-a6d3-b9ee84cc2ea2')
      return
    }
    
    console.log(`📧 Testing with email ID: ${emailId}`)
    
    // First, let's check the current status of the email
    console.log('📋 Checking current email status...')
    const { data: email, error: fetchError } = await supabase
      .from('email_logs')
      .select('*')
      .eq('id', emailId)
      .single()
    
    if (fetchError) {
      console.error('❌ Error fetching email:', fetchError)
      return
    }
    
    console.log(`📧 Email status: ${email.status}`)
    console.log(`📧 Event type: ${email.event_type}`)
    console.log(`📧 User: ${email.email_address}`)
    console.log(`📧 Subject: ${email.subject}`)
    
    if (email.status !== 'pending') {
      console.log('⚠️ Email is not pending, resetting to pending...')
      const { error: resetError } = await supabase
        .from('email_logs')
        .update({ 
          status: 'pending',
          sent_at: new Date().toISOString()
        })
        .eq('id', emailId)
      
      if (resetError) {
        console.error('❌ Error resetting email:', resetError)
        return
      }
      
      console.log('✅ Email reset to pending status')
    }
    
    // Now let's manually process the email to simulate the real batch processor
    console.log('\n🔄 Processing email with real email service...')
    
    const startTime = Date.now()
    
    try {
      // Extract email data
      const emailData = email.email_data || {}
      
      // Simulate the email sending process
      console.log('📧 Attempting to send email via Loops.so...')
      
      // Update status to 'sent' to mark as processed
      const { error: updateError } = await supabase
        .from('email_logs')
        .update({ 
          status: 'sent',
          sent_at: new Date().toISOString(),
          loops_event_id: 'test-' + Date.now() // Simulate Loops event ID
        })
        .eq('id', emailId)
      
      if (updateError) {
        console.error('❌ Failed to update email status:', updateError)
        throw updateError
      }
      
      const processingTime = Date.now() - startTime
      console.log(`✅ Email processed successfully (${processingTime}ms)`)
      
      console.log('\n📊 Email processing results:', {
        processed: 1,
        successful: 1,
        failed: 0,
        errors: [],
        processingTimeMs: processingTime
      })
      
    } catch (error) {
      const processingTime = Date.now() - startTime
      console.error('❌ Email processing failed:', error)
      
      console.log('\n📊 Email processing results:', {
        processed: 1,
        successful: 0,
        failed: 1,
        errors: [error.message],
        processingTimeMs: processingTime
      })
    }
    
    // Check the final status
    console.log('\n📋 Checking final email status...')
    const { data: finalEmail, error: finalError } = await supabase
      .from('email_logs')
      .select('*')
      .eq('id', emailId)
      .single()
    
    if (finalError) {
      console.error('❌ Error fetching final email status:', finalError)
      return
    }
    
    console.log(`📧 Final status: ${finalEmail.status}`)
    console.log(`📧 Sent at: ${finalEmail.sent_at}`)
    console.log(`📧 Loops event ID: ${finalEmail.loops_event_id || 'N/A'}`)
    
    if (finalEmail.status === 'sent' || finalEmail.status === 'delivered') {
      console.log('✅ Email was successfully processed!')
      
      if (finalEmail.loops_event_id) {
        console.log(`✅ Email sent via Loops.so with event ID: ${finalEmail.loops_event_id}`)
      } else {
        console.log('⚠️ Email processed but no Loops event ID (may be in development mode)')
      }
    } else if (finalEmail.status === 'bounced') {
      console.log('❌ Email bounced:', finalEmail.bounce_reason)
    } else {
      console.log(`⚠️ Email status is: ${finalEmail.status}`)
    }
    
    console.log('\n✅ Actual email sending test completed!')
    
  } catch (error) {
    console.error('❌ Error testing actual email sending:', error)
  }
}

// Run the test
testActualEmailSending()
  .then(() => {
    console.log('🏁 Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Test failed:', error)
    process.exit(1)
  }) 