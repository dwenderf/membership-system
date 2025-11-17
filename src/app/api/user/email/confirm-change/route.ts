import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
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
 * Send confirmation email to both old and new addresses
 */
async function sendConfirmationEmail(
  email: string,
  firstName: string,
  oldEmail: string,
  newEmail: string
): Promise<void> {
  const { emailService } = await import('@/lib/email/service')

  const templateId = process.env.LOOPS_EMAIL_CHANGE_CONFIRMED_TEMPLATE_ID

  if (!templateId) {
    console.warn('LOOPS_EMAIL_CHANGE_CONFIRMED_TEMPLATE_ID not configured')
    return
  }

  await emailService.sendEmail({
    userId: '',
    email,
    eventType: 'email_change_confirmed' as any,
    subject: 'Your email address has been updated',
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

/**
 * Sync email change to Xero contact
 */
async function syncToXero(
  userId: string,
  oldEmail: string,
  newEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Dynamic import to avoid circular dependencies
    const xeroModule = await import('@/lib/xero/contacts')

    if (!xeroModule.syncEmailChangeToXero) {
      console.log('Xero sync function not available, skipping')
      return { success: false, error: 'Xero sync not available' }
    }

    return await xeroModule.syncEmailChangeToXero(userId, oldEmail, newEmail)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to sync email change to Xero:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const supabaseAdmin = await createAdminClient()

    // Get authenticated user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { verificationCode } = body

    if (!verificationCode) {
      return NextResponse.json(
        { error: 'Verification code is required' },
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

    // Find active email change request
    const { data: emailChangeRequest, error: requestError } = await supabase
      .from('email_change_requests')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (requestError || !emailChangeRequest) {
      await logEvent(
        supabase,
        user.id,
        user.email,
        null,
        'verification_failed',
        { reason: 'No active request found' },
        request
      )

      return NextResponse.json(
        { success: false, error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // Check if code has expired
    const expiresAt = new Date(emailChangeRequest.expires_at)
    if (expiresAt < new Date()) {
      // Mark request as expired
      await supabase
        .from('email_change_requests')
        .update({ status: 'expired' })
        .eq('id', emailChangeRequest.id)

      await logEvent(
        supabase,
        user.id,
        user.email,
        emailChangeRequest.new_email,
        'request_expired',
        {},
        request
      )

      await logEvent(
        supabase,
        user.id,
        user.email,
        emailChangeRequest.new_email,
        'verification_failed',
        { reason: 'Code expired' },
        request
      )

      return NextResponse.json(
        { success: false, error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // Verify code using constant-time comparison
    if (!constantTimeCompare(verificationCode, emailChangeRequest.verification_code)) {
      await logEvent(
        supabase,
        user.id,
        user.email,
        emailChangeRequest.new_email,
        'verification_failed',
        { reason: 'Invalid code' },
        request
      )

      return NextResponse.json(
        { success: false, error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // Log verification success
    await logEvent(
      supabase,
      user.id,
      user.email,
      emailChangeRequest.new_email,
      'verification_succeeded',
      {},
      request
    )

    const oldEmail = user.email
    const newEmail = emailChangeRequest.new_email

    // Update email in Supabase Auth
    try {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        { email: newEmail }
      )

      if (authUpdateError) {
        console.error('Failed to update email in Supabase Auth:', authUpdateError)
        throw new Error(`Auth update failed: ${authUpdateError.message}`)
      }
    } catch (authError) {
      console.error('Error updating Supabase Auth email:', authError)

      await logEvent(
        supabase,
        user.id,
        oldEmail,
        newEmail,
        'verification_failed',
        { reason: 'Auth update failed', error: authError instanceof Error ? authError.message : 'Unknown' },
        request
      )

      return NextResponse.json(
        { success: false, error: 'Failed to update email address' },
        { status: 500 }
      )
    }

    // Update email in users table
    try {
      const { error: dbUpdateError } = await supabase
        .from('users')
        .update({
          email: newEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (dbUpdateError) {
        console.error('Failed to update email in users table:', dbUpdateError)

        // Attempt to rollback auth change (best effort)
        try {
          await supabaseAdmin.auth.admin.updateUserById(user.id, { email: oldEmail })
        } catch (rollbackError) {
          console.error('Failed to rollback auth email change:', rollbackError)
        }

        throw new Error(`Database update failed: ${dbUpdateError.message}`)
      }
    } catch (dbError) {
      console.error('Error updating database email:', dbError)

      await logEvent(
        supabase,
        user.id,
        oldEmail,
        newEmail,
        'verification_failed',
        { reason: 'Database update failed', error: dbError instanceof Error ? dbError.message : 'Unknown' },
        request
      )

      return NextResponse.json(
        { success: false, error: 'Failed to update email address' },
        { status: 500 }
      )
    }

    // Mark request as completed
    await supabase
      .from('email_change_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', emailChangeRequest.id)

    // Log email update success
    await logEvent(
      supabase,
      user.id,
      oldEmail,
      newEmail,
      'email_updated',
      {},
      request
    )

    // Sync to Xero (non-blocking)
    try {
      const xeroResult = await syncToXero(user.id, oldEmail, newEmail)

      await logEvent(
        supabase,
        user.id,
        oldEmail,
        newEmail,
        xeroResult.success ? 'xero_sync_succeeded' : 'xero_sync_failed',
        xeroResult.error ? { error: xeroResult.error } : {},
        request
      )
    } catch (xeroError) {
      console.error('Xero sync error:', xeroError)
      // Don't fail the request, Xero sync is non-blocking
    }

    // Send confirmation emails to both addresses
    try {
      await sendConfirmationEmail(oldEmail, user.first_name, oldEmail, newEmail)
      await sendConfirmationEmail(newEmail, user.first_name, oldEmail, newEmail)
    } catch (emailError) {
      console.error('Error sending confirmation emails:', emailError)
      // Don't fail the request, just log
    }

    return NextResponse.json({
      success: true,
      message: 'Email address updated successfully'
    })

  } catch (error) {
    console.error('Unexpected error in confirm-change:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
