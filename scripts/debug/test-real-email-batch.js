/**
 * Test script to verify real email batch processing
 * 
 * This script resets an email to pending and then processes it
 * using the real email batch processor to test actual email sending.
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testRealEmailBatch() {
  console.log('🧪 Testing real email batch processing...')
  
  try {
    // Get email ID from command line arguments
    const emailId = process.argv[2]
    if (!emailId) {
      console.error('❌ Please provide an email ID as an argument')
      console.error('Usage: node test-real-email-batch.js <email_id>')
      console.error('Example: node test-real-email-batch.js a766a166-d925-401f-a6d3-b9ee84cc2ea2')
      return
    }
    
    console.log(`📧 Testing with email ID: ${emailId}`)
    
    // First, let's reset the email back to pending
    console.log('🔄 Resetting email back to pending...')
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
    
    // Check current status
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
    
    // Now let's manually process the email using the real email service logic
    console.log('\n🔄 Processing email with real email service...')
    
    const startTime = Date.now()
    
    try {
      // Extract email data
      const emailData = email.email_data || {}
      
      // Create Loops client
      const { LoopsClient } = require('loops')
      const loops = new LoopsClient(process.env.LOOPS_API_KEY)
      
      console.log('📧 Sending email via Loops.so...')
      
             // Send the email based on event type
       let loopsResponse
       if (email.event_type === 'membership.purchased') {
         // Clean data to ensure no undefined values
         const cleanData = Object.fromEntries(
           Object.entries(emailData).filter(([_, value]) => value !== undefined)
         )
         
         // Add missing required fields for the template
         const enrichedData = {
           ...cleanData,
           purchaseDate: new Date().toLocaleDateString(),
           dashboardUrl: 'https://hockeyassociation.org/user/dashboard'
         }
         
         console.log('📧 Sending with enriched data:', enrichedData)
         
         loopsResponse = await loops.sendTransactionalEmail({
           transactionalId: email.template_id,
           email: email.email_address,
           dataVariables: enrichedData
         })
      } else {
        // Send as a basic contact event
        loopsResponse = await loops.sendEvent({
          email: email.email_address,
          eventName: email.event_type,
          eventProperties: {
            subject: email.subject,
            ...emailData
          }
        })
      }
      
      console.log('📊 Loops response:', loopsResponse)
      
      // Update email log with results
      if (loopsResponse && 'success' in loopsResponse && loopsResponse.success) {
        const { error: updateError } = await supabase
          .from('email_logs')
          .update({ 
            status: 'delivered',
            sent_at: new Date().toISOString(),
            loops_event_id: loopsResponse.id || 'sent'
          })
          .eq('id', emailId)
        
        if (updateError) {
          console.error('❌ Failed to update email status:', updateError)
          throw updateError
        }
        
        const processingTime = Date.now() - startTime
        console.log(`✅ Email sent successfully via Loops! (${processingTime}ms)`)
        console.log(`📧 Loops event ID: ${loopsResponse.id || 'N/A'}`)
        
      } else {
        // Email failed
        const { error: updateError } = await supabase
          .from('email_logs')
          .update({ 
            status: 'bounced',
            sent_at: new Date().toISOString(),
            bounce_reason: 'Loops API error'
          })
          .eq('id', emailId)
        
        if (updateError) {
          console.error('❌ Failed to update email status:', updateError)
        }
        
        throw new Error('Loops API returned failure')
      }
      
    } catch (error) {
      const processingTime = Date.now() - startTime
      console.error('❌ Email processing failed:', error)
      
      // Update status to bounced
      const { error: updateError } = await supabase
        .from('email_logs')
        .update({ 
          status: 'bounced',
          sent_at: new Date().toISOString(),
          bounce_reason: error.message
        })
        .eq('id', emailId)
      
      if (updateError) {
        console.error('❌ Failed to update email status:', updateError)
      }
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
    
    if (finalEmail.status === 'delivered') {
      console.log('✅ Email was successfully delivered via Loops!')
    } else if (finalEmail.status === 'bounced') {
      console.log('❌ Email bounced:', finalEmail.bounce_reason)
    } else {
      console.log(`⚠️ Email status is: ${finalEmail.status}`)
    }
    
    console.log('\n✅ Real email batch test completed!')
    
  } catch (error) {
    console.error('❌ Error testing real email batch:', error)
  }
}

// Run the test
testRealEmailBatch()
  .then(() => {
    console.log('🏁 Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Test failed:', error)
    process.exit(1)
  }) 