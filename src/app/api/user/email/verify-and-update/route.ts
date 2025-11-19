import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { syncEmailChangeToXero } from '@/lib/xero/contacts'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { newEmail, code } = await request.json()

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const oldEmail = user.email!

    // Find and verify the code
    const { data: verificationRecord, error: codeError } = await supabase
      .from('email_verification_codes')
      .select('*')
      .eq('user_id', user.id)
      .eq('new_email', newEmail.toLowerCase())
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (codeError || !verificationRecord) {
      await supabase.from('email_change_logs').insert({
        user_id: user.id,
        old_email: oldEmail,
        new_email: newEmail,
        event_type: 'email_update_failed',
        metadata: { reason: 'invalid_or_expired_code' },
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        user_agent: request.headers.get('user-agent')
      })

      return NextResponse.json(
        { error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // Mark code as used
    await supabase
      .from('email_verification_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', verificationRecord.id)

    // Update email in auth.users using admin API
    const supabaseAdmin = await createClient()
    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { email: newEmail }
    )

    if (updateAuthError) {
      console.error('Error updating auth email:', updateAuthError)
      await supabase.from('email_change_logs').insert({
        user_id: user.id,
        old_email: oldEmail,
        new_email: newEmail,
        event_type: 'email_update_failed',
        metadata: { reason: 'auth_update_failed', error: updateAuthError.message },
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        user_agent: request.headers.get('user-agent')
      })

      return NextResponse.json(
        { error: 'Failed to update email' },
        { status: 500 }
      )
    }

    // Update email in users table
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ email: newEmail })
      .eq('id', user.id)

    if (updateUserError) {
      console.error('Error updating users table:', updateUserError)
    }

    // Log successful update
    await supabase.from('email_change_logs').insert({
      user_id: user.id,
      old_email: oldEmail,
      new_email: newEmail,
      event_type: 'email_updated',
      metadata: { method: 'otp_code' },
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      user_agent: request.headers.get('user-agent')
    })

    // Sync to Xero (non-blocking)
    syncEmailChangeToXero(user.id, oldEmail, newEmail).catch((error) => {
      console.error('Error syncing email change to Xero:', error)
    })

    // Send confirmation emails via Loops.so (non-blocking)
    Promise.all([
      // Email to old address
      fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionalId: 'email-changed-old',
          email: oldEmail,
          dataVariables: {
            oldEmail,
            newEmail
          }
        })
      }),
      // Email to new address
      fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionalId: 'email-changed-new',
          email: newEmail,
          dataVariables: {
            oldEmail,
            newEmail
          }
        })
      })
    ]).catch((error) => {
      console.error('Error sending confirmation emails:', error)
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Unexpected error in verify-and-update:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
