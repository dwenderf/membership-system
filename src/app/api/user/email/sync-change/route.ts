import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging/logger'

/**
 * Log email change event
 */
async function logEvent(
  supabase: SupabaseClient,
  userId: string,
  oldEmail: string,
  newEmail: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
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
  newEmail: string,
  googleAuthWarning: string = ''
): Promise<void> {
  const { emailService } = await import('@/lib/email/service')

  const templateId = process.env.LOOPS_EMAIL_CHANGE_CONFIRMED_TEMPLATE_ID

  if (!templateId) {
    logger.logSystem('email-change-confirmation-template-missing', 'LOOPS_EMAIL_CHANGE_CONFIRMED_TEMPLATE_ID not configured', undefined, 'warn')
    return
  }

  const { EMAIL_EVENTS } = await import('@/lib/email/service')

  await emailService.sendEmailImmediately({
    userId: '',
    email,
    eventType: EMAIL_EVENTS.EMAIL_CHANGE_CONFIRMED,
    subject: 'Your email address has been updated',
    templateId,
    data: {
      firstName,
      oldEmail,
      newEmail,
      googleAuthWarning,
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
      logger.logSystem('email-change-xero-sync-unavailable', 'Xero sync function not available, skipping', { userId }, 'warn')
      return { success: false, error: 'Xero sync not available' }
    }

    return await xeroModule.syncEmailChangeToXero(userId, oldEmail, newEmail)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.logSystem('email-change-xero-sync-error', 'Failed to sync email change to Xero', { userId, error: errorMessage }, 'error')
    return { success: false, error: errorMessage }
  }
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

    // Parse request body
    const body = await request.json()
    const { oldEmail, newEmail } = body

    if (!oldEmail || !newEmail) {
      return NextResponse.json(
        { error: 'Old email and new email are required' },
        { status: 400 }
      )
    }

    // Verify the new email matches what Supabase has
    if (authUser.email !== newEmail) {
      return NextResponse.json(
        { error: 'Email mismatch. Please try again.' },
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

    // Update email in users table
    const { error: dbUpdateError } = await supabase
      .from('users')
      .update({
        email: newEmail,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)

    if (dbUpdateError) {
      logger.logSystem('email-change-db-update-failed', 'Failed to update email in users table', { userId: user.id, error: dbUpdateError.message }, 'error')

      await logEvent(
        supabase,
        user.id,
        oldEmail,
        newEmail,
        'email_update_failed',
        { error: dbUpdateError.message },
        request
      )

      return NextResponse.json(
        { success: false, error: 'Failed to update email in database' },
        { status: 500 }
      )
    }

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
      logger.logSystem('email-change-xero-sync-unhandled-error', 'Xero sync error during email change', { userId: user.id, error: xeroError instanceof Error ? xeroError.message : String(xeroError) }, 'error')
      // Don't fail the request, Xero sync is non-blocking
    }

    // Check for Google OAuth mismatch
    let googleAuthWarning = ''
    try {
      const { data: identitiesData } = await supabase.auth.getUserIdentities()
      const identities = identitiesData?.identities || []
      const googleIdentity = identities.find((id) => id.provider === 'google')

      if (googleIdentity && googleIdentity.identity_data?.email) {
        const googleEmail = googleIdentity.identity_data.email

        // Check if Google email differs from new email
        if (googleEmail.toLowerCase() !== newEmail.toLowerCase()) {
          googleAuthWarning = `IMPORTANT: Your Google account (${googleEmail}) is still linked to this account but uses a different email address. If you no longer want to sign in with Google, you can unlink it in your Account Settings under "Account Security".`
        }
      }
    } catch (oauthError) {
      logger.logSystem('email-change-oauth-check-error', 'Error checking OAuth status during email change', { userId: user.id, error: oauthError instanceof Error ? oauthError.message : String(oauthError) }, 'warn')
      // Don't fail the request, just log
    }

    // Send confirmation emails to both addresses
    const userFirstName = user.first_name || 'User'
    try {
      await sendConfirmationEmail(oldEmail, userFirstName, oldEmail, newEmail, googleAuthWarning)
      await sendConfirmationEmail(newEmail, userFirstName, oldEmail, newEmail, googleAuthWarning)
    } catch (emailError) {
      logger.logSystem('email-change-confirmation-send-error', 'Error sending confirmation emails for email change', { userId: user.id, error: emailError instanceof Error ? emailError.message : String(emailError) }, 'error')
      // Don't fail the request, just log
    }

    // Send notification to admins with user identification
    const supportEmail = process.env.SUPPORT_EMAIL
    if (supportEmail) {
      try {
        const adminFirstName = `${userFirstName} (${oldEmail})`
        await sendConfirmationEmail(supportEmail, adminFirstName, oldEmail, newEmail, googleAuthWarning)
      } catch (adminEmailError) {
        logger.logSystem('email-change-admin-notification-error', 'Error sending admin notification for email change', { userId: user.id, error: adminEmailError instanceof Error ? adminEmailError.message : String(adminEmailError) }, 'warn')
        // Don't fail the request, just log
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Email address updated successfully'
    })

  } catch (error) {
    logger.logSystem('email-sync-change-unexpected-error', 'Unexpected error in sync-change', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
