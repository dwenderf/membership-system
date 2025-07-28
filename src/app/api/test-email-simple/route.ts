import { NextRequest, NextResponse } from 'next/server'
import { emailService } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    // Simple test email without authentication
    const result = await emailService.sendWelcomeEmail({
      userId: 'test-user-id',
      email: 'david.wender@gmail.com', // Replace with your email
      userName: 'Test User'
    })

    return NextResponse.json({
      success: result.success,
      message: result.success 
        ? 'Test email sent successfully (check your email and database)' 
        : `Email failed: ${result.error}`,
      loopsEventId: result.loopsEventId,
      environment: process.env.NODE_ENV,
      loopsApiKeyConfigured: !!process.env.LOOPS_API_KEY,
      templateIdConfigured: !!process.env.LOOPS_WELCOME_TEMPLATE_ID
    })
    
  } catch (error) {
    console.error('Error sending test email:', error)
    return NextResponse.json(
      { 
        error: 'Failed to send test email',
        details: error instanceof Error ? error.message : 'Unknown error',
        environment: process.env.NODE_ENV
      },
      { status: 500 }
    )
  }
}

// Also allow GET requests for easier testing
export async function GET() {
  return NextResponse.json({
    message: 'Email test endpoint is working',
    environment: process.env.NODE_ENV,
    loopsApiKeyConfigured: !!process.env.LOOPS_API_KEY,
    templateIdConfigured: !!process.env.LOOPS_WELCOME_TEMPLATE_ID,
    instructions: 'Send a POST request to test email sending'
  })
} 