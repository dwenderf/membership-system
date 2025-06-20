import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email-service'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Send test email
    const result = await emailService.sendWelcomeEmail({
      userId: user.id,
      email: userProfile.email,
      userName: `${userProfile.first_name} ${userProfile.last_name}`
    })

    return NextResponse.json({
      success: result.success,
      message: result.success 
        ? 'Test email sent successfully (check console and database)' 
        : `Email failed: ${result.error}`,
      loopsEventId: result.loopsEventId
    })
    
  } catch (error) {
    console.error('Error sending test email:', error)
    return NextResponse.json(
      { error: 'Failed to send test email' },
      { status: 500 }
    )
  }
}