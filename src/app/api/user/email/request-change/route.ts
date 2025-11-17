import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateVerificationCode(): string {
  return randomInt(0, 1000000).toString().padStart(6, '0')
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Check if user has exceeded rate limit (max 3 requests per hour)
 */
async function checkRateLimit(supabase: any, userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const { count, error } = await supabase
    .from('email_change_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'request_created')
    .gte('created_at', oneHourAgo.toISOString())

  if (error) {
    console.error('Error checking rate limit:', error)
    throw error
  }

  return (count ?? 0) < 3
}

/**
 * Check if session is fresh (< 5 minutes old)
 */
function isSessionFresh(session: any): boolean {
  if (!session?.created_at) return false
  const sessionAge = Date.now() - new Date(session.created_at).getTime()
  const FIVE_MINUTES = 5 * 60 * 1000
  return sessionAge < FIVE_MINUTES
}

/**
 * Log email change event
 */
async function logEvent(
  supabase: any,
  userId: string,
  oldEmail: string,
  newEmail: string | null,
  eventType: string,
  metadata: any = {},
  request: NextRequest
) {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
  const userAgent = request.headers.get('user-agent')

  await supabase.from('email_change_logs').insert({
    user_id: userId,
    old_email: oldEmail,
    new_email: newEmail,
    event_type: eventType,
    metadata,
    ip_address: ip,
    user_agent: userAgent
  })
}

/**
 * Send verification email to new address
 */
async function sendVerificationEmail(
  email: string,
  firstName: string,
  verificationCode: string
): Promise<void> {
  const { emailService } = await import('@/lib/email/service')

  const templateId = process.env.LOOPS_EMAIL_CHANGE_VERIFICATION_TEMPLATE_ID

  if (!templateId) {
    console.warn('LOOPS_EMAIL_CHANGE_VERIFICATION_TEMPLATE_ID not configured')
    return
  }

  await emailService.sendEmail({
    userId: '', // Not applicable for new email
    email,
    eventType: 'email_change_verification' as any,
    subject: 'Verify your new email address',
    templateId,
    data: {
      firstName,
      verificationCode,
      organizationName: process.env.ORGANIZATION_NAME || 'Membership System'
    }
  })
}

/**
 * Send security alert to old address
 */
async function sendSecurityAlert(
  email: string,
  firstName: string,
  oldEmail: string,
  newEmail: string
): Promise<void> {
  const { emailService } = await import('@/lib/email/service')

  const templateId = process.env.LOOPS_EMAIL_CHANGE_SECURITY_ALERT_TEMPLATE_ID

  if (!templateId) {
    console.warn('LOOPS_EMAIL_CHANGE_SECURITY_ALERT_TEMPLATE_ID not configured')
    return
  }

  await emailService.sendEmail({
    userId: '', // Will be set by caller
    email,
    eventType: 'email_change_security_alert' as any,
    subject: 'Email change requested for your account',
    templateId,
    data: {
      firstName,
      oldEmail,
      newEmail,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
      organizationName: process.env.ORGANIZATION_NAME || 'Membership System'
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check session freshness
    const { data: { session } } = await supabase.auth.getSession()

    if (!session || !isSessionFresh(session)) {
      return NextResponse.json(
        { error: 'Please re-authenticate to continue' },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { newEmail } = body

    // Validate email format
    if (!newEmail || !isValidEmail(newEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Get user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name')
      .eq('id', authUser.id)
      .single()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if trying to change to same email
    if (newEmail.toLowerCase() === user.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'New email must be different from current email' },
        { status: 400 }
      )
    }

    // Check rate limiting
    const withinRateLimit = await checkRateLimit(supabase, user.id)

    if (!withinRateLimit) {
      // Log rate limit hit
      await logEvent(
        supabase,
        user.id,
        user.email,
        newEmail,
        'rate_limit_hit',
        {},
        request
      )

      // Return generic message for anti-enumeration
      return NextResponse.json({
        success: true,
        message: 'If the email address is available, a verification code has been sent to it.'
      })
    }

    // Check if new email already exists (but don't reveal to user)
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', newEmail.toLowerCase())
      .single()

    // If email exists, return success but don't actually send anything
    if (existingUser) {
      // Log this for monitoring
      await logEvent(
        supabase,
        user.id,
        user.email,
        newEmail,
        'request_created',
        { email_already_exists: true },
        request
      )

      return NextResponse.json({
        success: true,
        message: 'If the email address is available, a verification code has been sent to it.'
      })
    }

    // Cancel any existing pending requests
    await supabase
      .from('email_change_requests')
      .update({ status: 'cancelled' })
      .eq('user_id', user.id)
      .in('status', ['pending', 'verified'])

    // Generate verification code
    const verificationCode = generateVerificationCode()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    // Store request in database
    const { error: insertError } = await supabase
      .from('email_change_requests')
      .insert({
        user_id: user.id,
        old_email: user.email,
        new_email: newEmail,
        verification_code: verificationCode,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        user_agent: request.headers.get('user-agent')
      })

    if (insertError) {
      console.error('Error creating email change request:', insertError)
      return NextResponse.json(
        { error: 'Failed to create email change request' },
        { status: 500 }
      )
    }

    // Send verification email to new address
    try {
      await sendVerificationEmail(newEmail, user.first_name, verificationCode)
    } catch (emailError) {
      console.error('Error sending verification email:', emailError)
      // Don't fail the request, just log
    }

    // Send security alert to old address
    try {
      await sendSecurityAlert(user.email, user.first_name, user.email, newEmail)
    } catch (emailError) {
      console.error('Error sending security alert:', emailError)
      // Don't fail the request, just log
    }

    // Log event
    await logEvent(
      supabase,
      user.id,
      user.email,
      newEmail,
      'request_created',
      {},
      request
    )

    await logEvent(
      supabase,
      user.id,
      user.email,
      newEmail,
      'verification_sent',
      {},
      request
    )

    // Return generic success message (anti-enumeration)
    return NextResponse.json({
      success: true,
      message: 'If the email address is available, a verification code has been sent to it.'
    })

  } catch (error) {
    console.error('Unexpected error in request-change:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
