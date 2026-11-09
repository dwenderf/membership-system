import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { emailService } from '@/lib/email'
import { logger } from '@/lib/logging/logger'

export async function POST() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const supabase = await createClient()

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', auth.user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Send test email
    const result = await emailService.sendWelcomeEmail({
      userId: auth.user.id,
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
    logger.logSystem('test-email-send-error', 'Error sending test email', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json(
      { error: 'Failed to send test email' },
      { status: 500 }
    )
  }
}
