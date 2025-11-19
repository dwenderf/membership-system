import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { storeCode } from '@/lib/reauth-codes'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user || !user.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Generate a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()

    // Store code with 15-minute expiration
    const expiresAt = Date.now() + 15 * 60 * 1000
    storeCode(user.id, code, expiresAt)

    // Get user's first name for email
    const { data: userData } = await supabase
      .from('users')
      .select('first_name')
      .eq('id', user.id)
      .single()

    // Send code via email
    const { emailService } = await import('@/lib/email/service')

    const templateId = process.env.LOOPS_REAUTH_CODE_TEMPLATE_ID || 'reauth-code'

    await emailService.sendEmail({
      userId: user.id,
      email: user.email,
      eventType: 'reauth_code' as any,
      subject: 'Identity Verification Code',
      templateId,
      data: {
        firstName: userData?.first_name || 'there',
        code,
        expiresIn: '15 minutes'
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Verification code sent'
    })

  } catch (error) {
    console.error('Error sending reauth code:', error)
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    )
  }
}
