import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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
      console.error('Failed to update email in users table:', dbUpdateError)

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
    console.error('Unexpected error in sync-change:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
