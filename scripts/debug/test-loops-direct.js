/**
 * Test script to verify Loops email sending directly
 * 
 * This script directly uses the Loops client to test email sending
 * without importing TypeScript modules.
 */

const { LoopsClient } = require('loops')
require('dotenv').config({ path: '.env.local' })

async function testLoopsDirect() {
  console.log('🧪 Testing Loops email sending directly...')
  
  try {
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
    
    // Test sending a transactional email
    console.log('📧 Sending test transactional email...')
    
    const emailData = {
      userName: 'David Wender',
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
      email: 'david.wender@nycgha.org',
      dataVariables: emailData
    })
    
    console.log('📊 Loops response:', loopsResponse)
    
    if (loopsResponse && 'success' in loopsResponse && loopsResponse.success) {
      console.log('✅ Email sent successfully via Loops!')
      console.log(`📧 Loops event ID: ${loopsResponse.id || 'N/A'}`)
    } else {
      console.error('❌ Email sending failed via Loops')
      console.error('Response:', loopsResponse)
    }
    
    console.log('\n✅ Loops direct test completed!')
    
  } catch (error) {
    console.error('❌ Error testing Loops directly:', error)
    
    // Log more details about the error
    if (error.response) {
      console.error('Response status:', error.response.status)
      console.error('Response data:', error.response.data)
    }
  }
}

// Run the test
testLoopsDirect()
  .then(() => {
    console.log('🏁 Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Test failed:', error)
    process.exit(1)
  }) 