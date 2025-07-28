import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailService } from '@/lib/email'
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

    // Step 1: Mark the public.users record as deleted while preserving business data
    const { error: updateError } = await supabase
      .from('users')
      .update({
        first_name: 'Deleted',
        last_name: 'User', 
        email: `deleted_user_${user.id}@deleted.local`,
        phone: null,
        deleted_at: deletionTimestamp,
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Failed to mark user as deleted:', updateError)
      captureCriticalAccountDeletionError(updateError, {
        ...deletionContext,
        step: 'database_update',
        emailSent
      })
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    // Step 2: Sign out the user BEFORE auth deletion to prevent session issues
    try {
      await supabase.auth.signOut()
    } catch (signOutError) {
      console.error('Failed to sign out user before deletion:', signOutError)
      // Continue with deletion - sign out failure shouldn't block the process
    }

    // Step 3: Delete the auth.users record completely (prevents all future authentication)
    // With the foreign key constraint removed, this won't affect the business data
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id)

    if (deleteUserError) {
      console.error('Failed to delete auth.users record:', deleteUserError)
      captureCriticalAccountDeletionError(deleteUserError, {
        ...deletionContext,
        step: 'auth_delete',
        emailSent
      })
      return NextResponse.json({ error: 'Failed to complete account deletion' }, { status: 500 })
    }

    console.log('Successfully deleted auth.users record while preserving business data for user:', user.id)

    return NextResponse.json({ 
      success: true, 
      message: 'Account successfully deleted' 
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