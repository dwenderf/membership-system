import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

/**
 * Hash a code using SHA-256
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * Check rate limit: max 3 codes per hour per user
 */
async function checkRateLimit(supabase: any, userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const { count, error } = await supabase
    .from('reauth_verification_codes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo.toISOString())

  if (error) {
    console.error('Error checking rate limit:', error)
    return false
  }

  return (count ?? 0) < 3
}

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

    // Check rate limit
    const withinLimit = await checkRateLimit(supabase, user.id)

    if (!withinLimit) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before requesting another code.' },
        { status: 429 }
      )
    }

    // Clean up any existing unused codes for this user
    await supabase
      .from('reauth_verification_codes')
      .delete()
      .eq('user_id', user.id)
      .is('used_at', null)

    // Generate a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const codeHash = hashCode(code)

    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
    const userAgent = request.headers.get('user-agent')

    // Store code in database with 15-minute expiration
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const { error: insertError } = await supabase
      .from('reauth_verification_codes')
      .insert({
        user_id: user.id,
        code_hash: codeHash,
        expires_at: expiresAt.toISOString(),
        ip_address: ip,
        user_agent: userAgent
      })

    if (insertError) {
      console.error('Error storing verification code:', insertError)
      return NextResponse.json(
        { error: 'Failed to generate verification code' },
        { status: 500 }
      )
    }

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
