import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailService } from '@/lib/email-service'
import { captureCriticalAccountDeletionError, captureAccountDeletionWarning } from '@/lib/sentry-helpers'

export async function POST(request: NextRequest) {
  let deletionContext: any = {}
  
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile before deletion for email confirmation
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('email, first_name, last_name, deleted_at')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      const error = new Error('User profile not found')
      captureCriticalAccountDeletionError(error, {
        userId: user.id,
        userEmail: user.email || 'unknown',
        step: 'database_update'
      })
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Set up deletion context for error tracking
    deletionContext = {
      userId: user.id,
      userEmail: userProfile.email,
      userName: userProfile.first_name,
      originalEmail: userProfile.email
    }

    // Check if account is already deleted
    if (userProfile.deleted_at) {
      captureAccountDeletionWarning('Account deletion attempted on already deleted account', {
        ...deletionContext,
        step: 'database_update'
      })
      return NextResponse.json({ error: 'Account already deleted' }, { status: 400 })
    }

    // Store original email and name for confirmation email (before anonymization)
    const originalEmail = userProfile.email
    const originalFirstName = userProfile.first_name
    const deletionTimestamp = new Date().toISOString()

    // Send confirmation email BEFORE anonymizing the account
    let emailSent = false
    try {
      await emailService.sendAccountDeletionConfirmation({
        userId: user.id,
        email: originalEmail,
        userName: originalFirstName,
        deletedAt: deletionTimestamp,
        supportEmail: 'support@hockeyassociation.org' // Replace with your support email
      })
      emailSent = true
      deletionContext.emailSent = true
    } catch (emailError) {
      console.error('Failed to send account deletion confirmation email:', emailError)
      captureAccountDeletionWarning('Account deletion email failed to send', {
        ...deletionContext,
        step: 'email_send',
        emailSent: false
      }, emailError)
      // Continue with deletion even if email fails
    }

    // Generate the anonymized email that will be used in both tables
    const anonymizedEmail = `deleted_user_${user.id}@deleted.local`

    // Step 1: Anonymize the public.users record
    const { error: updateError } = await supabase
      .from('users')
      .update({
        first_name: 'Deleted',
        last_name: 'User',
        email: anonymizedEmail,
        phone: null,
        deleted_at: deletionTimestamp,
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Account deletion error:', updateError)
      captureCriticalAccountDeletionError(updateError, {
        ...deletionContext,
        step: 'database_update',
        emailSent
      })
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    // Step 2: Update auth.users email to match (prevents re-authentication)
    // Create admin client with service role key for admin operations
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // First update the auth.users email
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(user.id, {
      email: anonymizedEmail
    })

    if (authUpdateError) {
      console.error('Failed to update auth.users email:', authUpdateError)
      captureCriticalAccountDeletionError(authUpdateError, {
        ...deletionContext,
        step: 'auth_update',
        emailSent
      })
      return NextResponse.json({ error: 'Failed to complete account deletion' }, { status: 500 })
    }

    // Step 3: Unlink all OAuth identities to prevent re-authentication via OAuth
    try {
      const { data: userData } = await adminClient.auth.admin.getUserById(user.id)
      
      if (userData.user?.identities && userData.user.identities.length > 0) {
        for (const identity of userData.user.identities) {
          const { error: unlinkError } = await adminClient.auth.admin.unlinkIdentity({
            userId: user.id,
            identityId: identity.id
          })
          
          if (unlinkError) {
            console.error('Failed to unlink identity:', identity.provider, unlinkError)
            captureAccountDeletionWarning('Failed to unlink OAuth identity during account deletion', {
              ...deletionContext,
              step: 'identity_unlink',
              emailSent
            }, { provider: identity.provider, error: unlinkError })
          }
        }
      }
    } catch (identityError) {
      console.error('Failed to process OAuth identities:', identityError)
      captureAccountDeletionWarning('Failed to process OAuth identities during account deletion', {
        ...deletionContext,
        step: 'identity_unlink',
        emailSent
      }, identityError)
    }

    // Sign out the user from Supabase auth
    try {
      await supabase.auth.signOut()
    } catch (signOutError) {
      console.error('Failed to sign out user:', signOutError)
      captureAccountDeletionWarning('Account deletion succeeded but sign out failed', {
        ...deletionContext,
        step: 'auth_signout',
        emailSent
      }, signOutError)
      // Don't fail the whole operation if sign out fails
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Account successfully deleted and anonymized' 
    })

  } catch (error) {
    console.error('Account deletion error:', error)
    
    // Capture critical error with all available context
    captureCriticalAccountDeletionError(error, {
      ...deletionContext,
      step: 'unknown'
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}