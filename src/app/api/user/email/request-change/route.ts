import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

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

    // Check for re-authentication verification
    const cookieStore = await cookies()
    const reauthCookie = cookieStore.get('reauth_verified')

    if (!reauthCookie || reauthCookie.value !== authUser.id) {
      return NextResponse.json(
        { error: 'Re-authentication required. Please verify your identity first.' },
        { status: 403 }
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

      return NextResponse.json(
        { error: 'Too many email change requests. Please try again later.' },
        { status: 429 }
      )
    }

    // Check if new email already exists (but don't reveal to user in response)
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', newEmail.toLowerCase())
      .single()

    // If email exists, log but still proceed with Supabase call
    // Supabase will handle this gracefully
    if (existingUser) {
      await logEvent(
        supabase,
        user.id,
        user.email,
        newEmail,
        'request_created',
        { email_already_exists: true },
        request
      )
    }

    // Use Supabase's built-in email change functionality
    const { error: updateError } = await supabase.auth.updateUser(
      { email: newEmail },
      {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/user/account/email-changed`
      }
    )

    if (updateError) {
      console.error('Error requesting email change:', updateError)

      await logEvent(
        supabase,
        user.id,
        user.email,
        newEmail,
        'request_failed',
        { error: updateError.message },
        request
      )

      return NextResponse.json(
        { error: updateError.message },
        { status: 400 }
      )
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
      { method: 'supabase_builtin' },
      request
    )

    return NextResponse.json({
      success: true,
      message: 'Verification email sent. Please check your new email address and click the confirmation link.'
    })

  } catch (error) {
    console.error('Unexpected error in request-change:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
