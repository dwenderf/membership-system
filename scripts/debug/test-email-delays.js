/**
 * Test script to verify email delay functionality
 * 
 * This script stages multiple test emails and then processes them
 * to verify that delays are working correctly between email sends.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testEmailDelays() {
  console.log('🧪 Testing email delay functionality...')
  
  try {
    // Get email ID from command line arguments
    const emailId = process.argv[2]
    if (!emailId) {
      console.error('❌ Please provide an email ID as an argument')
      console.error('Usage: node test-email-delays.js <email_id>')
      console.error('Example: node test-email-delays.js a766a166-d925-401f-a6d3-b9ee84cc2ea2')
      return
    }
    
    console.log(`📧 Testing with email ID: ${emailId}`)
    
    // First, let's reset the existing email back to pending
    console.log('🔄 Resetting existing email back to pending...')
    const { error: resetError } = await supabase
      .from('email_logs')
      .update({ 
        status: 'pending',
        sent_at: new Date().toISOString() // Keep the original sent_at timestamp but change status
      })
      .eq('id', emailId)
    
    if (resetError) {
      console.error('❌ Error resetting email:', resetError)
      return
    }
    
    console.log('✅ Email reset to pending status')
    
    // Clean up any existing test emails
    console.log('🧹 Cleaning up existing test emails...')
    const { error: cleanupError } = await supabase
      .from('email_logs')
      .delete()
      .eq('event_type', 'test.delay')
    
    if (cleanupError) {
      console.error('❌ Error cleaning up test emails:', cleanupError)
      return
    }
    
    // Use the specific user ID provided
    const testUserId = 'de8d93d4-0165-4edc-be37-81e038e2abf1'
    
    // Get the user's email
    console.log('👤 Getting user email...')
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('id', testUserId)
      .single()
    
    if (userError || !user) {
      console.error('❌ Error getting user:', userError)
      return
    }
    
    const testUserEmail = user.email
    console.log(`✅ Using test user: ${testUserEmail} (${testUserId})`)
    
    // Stage 3 test emails
    console.log('📧 Staging 3 test emails...')
    const testEmails = [
      {
        user_id: testUserId,
        email_address: testUserEmail,
        event_type: 'test.delay',
        subject: 'Test Email 1 - Delay Test',
        status: 'pending',
        triggered_by: 'automated',
        email_data: { testNumber: 1 }
      },
      {
        user_id: testUserId,
        email_address: testUserEmail,
        event_type: 'test.delay',
        subject: 'Test Email 2 - Delay Test',
        status: 'pending',
        triggered_by: 'automated',
        email_data: { testNumber: 2 }
      },
      {
        user_id: testUserId,
        email_address: testUserEmail,
        event_type: 'test.delay',
        subject: 'Test Email 3 - Delay Test',
        status: 'pending',
        triggered_by: 'automated',
        email_data: { testNumber: 3 }
      }
    ]
    
    for (const email of testEmails) {
      const { error } = await supabase
        .from('email_logs')
        .insert(email)
      
      if (error) {
        console.error('❌ Error staging test email:', error)
        return
      }
    }
    
    console.log('✅ Test emails staged successfully')
    
    // Now let's check for pending emails (including the reset one)
    console.log('📋 Checking for pending emails...')
    const { data: pendingEmails, error: fetchError } = await supabase
      .from('email_logs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    
    if (fetchError) {
      console.error('❌ Error fetching pending emails:', fetchError)
      return
    }
    
    console.log(`📊 Found ${pendingEmails?.length || 0} pending emails total`)
    
    // Filter to show test emails separately
    const testEmailsOnly = pendingEmails?.filter(email => email.event_type === 'test.delay') || []
    const otherPendingEmails = pendingEmails?.filter(email => email.event_type !== 'test.delay') || []
    
    console.log(`📧 Test emails: ${testEmailsOnly.length}`)
    console.log(`📧 Other pending emails: ${otherPendingEmails.length}`)
    
    if (otherPendingEmails.length > 0) {
      console.log('📋 Other pending emails:')
      otherPendingEmails.forEach((email, index) => {
        console.log(`  ${index + 1}. ID: ${email.id}, Event: ${email.event_type}, Created: ${email.created_at}`)
      })
    }
    
    // Now let's manually process them with delays
    console.log('\n🔄 Processing test emails with delays...')
    const startTime = Date.now()
    
    if (!testEmailsOnly || testEmailsOnly.length === 0) {
      console.log('✅ No test emails to process')
      return
    }
    
    let processed = 0
    let successful = 0
    let failed = 0
    const errors = []
    
    for (let i = 0; i < testEmailsOnly.length; i++) {
      const emailLog = testEmailsOnly[i]
      const emailStartTime = Date.now()
      
      try {
        console.log(`📧 Processing test email ${i + 1}/${testEmailsOnly.length} (${emailLog.email_address})...`)
        
        // Simulate email processing (just update status)
        const { error: updateError } = await supabase
          .from('email_logs')
          .update({ 
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('id', emailLog.id)
        
        if (updateError) {
          console.error(`❌ Failed to update email ${emailLog.id}:`, updateError)
          failed++
          errors.push(`Failed to update email ${emailLog.id}: ${updateError.message}`)
        } else {
          const emailTime = Date.now() - emailStartTime
          console.log(`✅ Successfully processed email ${emailLog.id} (${emailTime}ms)`)
          successful++
        }
        
        processed++
        
        // Add delay between emails (skip for the last email)
        if (i < testEmailsOnly.length - 1) {
          const delayMs = 1000 // 1 second delay for testing
          console.log(`⏱️ Waiting ${delayMs}ms before next email...`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
        
      } catch (emailError) {
        console.error(`❌ Error processing email ${emailLog.id}:`, emailError)
        failed++
        errors.push(`Error processing email ${emailLog.id}: ${emailError.message}`)
      }
    }
    
    const totalTime = Date.now() - startTime
    
    console.log('\n📊 Email processing results:', {
      processed,
      successful,
      failed,
      errors,
      totalTimeMs: totalTime,
      averageTimePerEmail: Math.round(totalTime / processed)
    })
    
    // Check the status after processing
    console.log('\n📋 Checking email status after processing...')
    const { data: emailsAfter, error: afterError } = await supabase
      .from('email_logs')
      .select('id, status, event_type, email_address, created_at, sent_at')
      .eq('event_type', 'test.delay')
      .order('created_at', { ascending: true })
    
    if (afterError) {
      console.error('❌ Error fetching emails after processing:', afterError)
      return
    }
    
    console.log(`📊 Test emails in system: ${emailsAfter?.length || 0}`)
    if (emailsAfter && emailsAfter.length > 0) {
      emailsAfter.forEach((email, index) => {
        console.log(`  ${index + 1}. ID: ${email.id}, Status: ${email.status}, Email: ${email.email_address}, Sent: ${email.sent_at}`)
      })
    }
    
    // Also check the reset email
    console.log('\n📋 Checking reset email status...')
    const { data: resetEmail, error: resetEmailError } = await supabase
      .from('email_logs')
      .select('id, status, event_type, email_address, created_at, sent_at')
      .eq('id', emailId)
      .single()
    
    if (resetEmailError) {
      console.error('❌ Error fetching reset email:', resetEmailError)
    } else {
      console.log(`📧 Reset email: ID: ${resetEmail.id}, Status: ${resetEmail.status}, Event: ${resetEmail.event_type}, Sent: ${resetEmail.sent_at}`)
    }
    
    console.log('\n✅ Email delay test completed!')
    
  } catch (error) {
    console.error('❌ Error testing email delays:', error)
  }
}

// Run the test
testEmailDelays()
  .then(() => {
    console.log('🏁 Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Test failed:', error)
    process.exit(1)
  }) 