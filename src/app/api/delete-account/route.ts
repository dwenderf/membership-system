import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { emailService } from '@/lib/email'
import { getStripe } from '@/lib/stripe/server-client'
import { captureCriticalAccountDeletionError, captureAccountDeletionWarning } from '@/lib/sentry-helpers'
import { logger } from '@/lib/logging/logger'

const PRIVACY_EMAIL = process.env.PRIVACY_EMAIL || 'privacy@nycpha.org'

interface DeletionContext {
  userId?: string
  userEmail?: string
  userName?: string
  originalEmail?: string
  emailSent?: boolean
}

/**
 * Wraps deletion context + step (+ any triggering error) under `extra` so it
 * actually reaches Sentry - captureCriticalAccountDeletionError/captureAccountDeletionWarning
 * only read `.user`, `.request`, `.tags`, `.extra`, and `.level` off their context argument.
 */
function deletionErrorContext(deletionContext: DeletionContext, step: string, triggeringError?: unknown) {
  return {
    extra: {
      ...deletionContext,
      step,
      ...(triggeringError !== undefined && { triggeringError })
    }
  }
}

function isStripeResourceMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'resource_missing'
}

/**
 * Detaches all saved cards and deletes the Stripe customer. Runs before the
 * account is touched at all, so a failure here leaves everything retryable -
 * an already-deleted customer (e.g. a retried deletion) is treated as success.
 */
async function cleanupStripeCustomer(stripeCustomerId: string): Promise<void> {
  const stripe = getStripe()
  try {
    const paymentMethods = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card' })
    for (const paymentMethod of paymentMethods.data) {
      await stripe.paymentMethods.detach(paymentMethod.id)
    }
    await stripe.customers.del(stripeCustomerId)
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return
    }
    throw error
  }
}

export async function POST() {
  let deletionContext: DeletionContext = {}

  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile before deletion for email confirmation and cleanup
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('email, first_name, last_name, deleted_at, stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      const error = new Error('User profile not found')
      captureCriticalAccountDeletionError(error, deletionErrorContext(
        { userId: user.id, userEmail: user.email || 'unknown' },
        'database_update'
      ))
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
      captureAccountDeletionWarning(
        'Account deletion attempted on already deleted account',
        deletionErrorContext(deletionContext, 'database_update')
      )
      return NextResponse.json({ error: 'Account already deleted' }, { status: 400 })
    }

    // Check for active payment plans with outstanding balance
    const { data: activePaymentPlans, error: paymentPlansError } = await supabase
      .from('payment_plans')
      .select('id, total_amount, paid_amount')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (paymentPlansError) {
      // Sentry reporting is handled explicitly below via captureAccountDeletionWarning;
      // use 'warn' here (not 'error') to avoid double-reporting the same event to Sentry.
      logger.logSystem('account-deletion-payment-plans-check-error', 'Error checking payment plans during account deletion', { userId: user.id, error: paymentPlansError.message }, 'warn')
      captureAccountDeletionWarning(
        'Failed to check payment plans during deletion',
        deletionErrorContext(deletionContext, 'payment_plan_check', paymentPlansError)
      )
      // Continue with deletion despite error
    } else if (activePaymentPlans && activePaymentPlans.length > 0) {
      // Calculate total outstanding balance
      const totalOutstanding = activePaymentPlans.reduce((sum, plan) => {
        return sum + (plan.total_amount - plan.paid_amount)
      }, 0)

      if (totalOutstanding > 0) {
        return NextResponse.json({
          error: `Cannot delete account with outstanding payment plan balance. You have ${activePaymentPlans.length} active payment plan(s) with a total outstanding balance of $${(totalOutstanding / 100).toFixed(2)}. Please pay off your payment plans before deleting your account, or contact ${PRIVACY_EMAIL} for assistance.`,
          hasActivePaymentPlans: true,
          outstandingBalance: totalOutstanding
        }, { status: 400 })
      }
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
        supportEmail: PRIVACY_EMAIL
      })
      emailSent = true
      deletionContext.emailSent = true
    } catch (emailError) {
      logger.logSystem('account-deletion-confirmation-email-failed', 'Failed to send account deletion confirmation email', { userId: user.id, error: emailError instanceof Error ? emailError.message : String(emailError) }, 'warn')
      captureAccountDeletionWarning(
        'Account deletion email failed to send',
        deletionErrorContext({ ...deletionContext, emailSent: false }, 'email_send', emailError)
      )
      // Continue with deletion even if email fails
    }

    // Everything from here through the auth-user deletion below is safe to retry:
    // nothing in public.users or auth.users has been touched yet, so a failure at
    // any of these steps leaves the account fully intact (and the caller still
    // authenticated) to try again.

    // Step 1: Detach saved cards and delete the Stripe customer, if one exists
    if (userProfile.stripe_customer_id) {
      try {
        await cleanupStripeCustomer(userProfile.stripe_customer_id)
      } catch (stripeError) {
        logger.logSystem('account-deletion-stripe-cleanup-failed', 'Failed to clean up Stripe customer during account deletion', { userId: user.id, error: stripeError instanceof Error ? stripeError.message : String(stripeError) }, 'warn')
        captureCriticalAccountDeletionError(
          stripeError instanceof Error ? stripeError : new Error(String(stripeError)),
          deletionErrorContext({ ...deletionContext, emailSent }, 'stripe_cleanup')
        )
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
      }
    }

    // Step 2: Delete the Loops contact (identified by email - see deleteLoopsContact)
    try {
      await emailService.deleteLoopsContact(originalEmail)
    } catch (loopsError) {
      logger.logSystem('account-deletion-loops-cleanup-failed', 'Failed to delete Loops contact during account deletion', { userId: user.id, error: loopsError instanceof Error ? loopsError.message : String(loopsError) }, 'warn')
      captureCriticalAccountDeletionError(
        loopsError instanceof Error ? loopsError : new Error(String(loopsError)),
        deletionErrorContext({ ...deletionContext, emailSent }, 'loops_cleanup')
      )
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    // Step 3: Delete survey responses, which may contain sensitive free-text data.
    // (tournament_registrations.participant_info does not exist in this schema -
    // there is no equivalent table/column to scrub at this time.)
    const adminClient = createAdminClient()
    const { error: surveyResponsesError } = await adminClient
      .from('user_survey_responses')
      .delete()
      .eq('user_id', user.id)

    if (surveyResponsesError) {
      logger.logSystem('account-deletion-survey-responses-failed', 'Failed to delete survey responses during account deletion', { userId: user.id, error: surveyResponsesError.message }, 'warn')
      captureCriticalAccountDeletionError(
        surveyResponsesError,
        deletionErrorContext({ ...deletionContext, emailSent }, 'survey_responses_cleanup')
      )
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    // Step 4: Sign out the user BEFORE auth deletion to prevent session issues
    try {
      await supabase.auth.signOut()
    } catch (signOutError) {
      logger.logSystem('account-deletion-signout-failed', 'Failed to sign out user before deletion', { userId: user.id, error: signOutError instanceof Error ? signOutError.message : String(signOutError) }, 'warn')
      // Continue with deletion - sign out failure shouldn't block the process
    }

    // Step 5: Delete the auth.users record completely (prevents all future authentication
    // via any method - email, OAuth, magic links - and removes every trace of the email
    // from auth.users/auth.identities). This is the point of no return: once it succeeds,
    // the account can never sign in again, regardless of what happens next. It runs BEFORE
    // public.users is anonymized so that a failure here never leaves the misleading state of
    // an anonymized profile that can still log in - the account either stays fully intact
    // (safe to retry) or is already unreachable before any PII is touched.
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id)

    if (deleteUserError) {
      logger.logSystem('account-deletion-auth-delete-failed', 'Failed to delete auth.users record', { userId: user.id, error: deleteUserError.message }, 'warn')
      captureCriticalAccountDeletionError(
        deleteUserError,
        deletionErrorContext({ ...deletionContext, emailSent }, 'auth_delete')
      )
      return NextResponse.json({ error: 'Failed to complete account deletion' }, { status: 500 })
    }

    // Step 6: Mark the public.users record as deleted while preserving business data.
    // If this fails, the account is already unreachable (auth.users is gone), so the
    // only remaining risk is leftover PII, not renewed access - see AGENTS.md/issue #295
    // for why that's logged as critical and fixed up by hand rather than retried here.
    const { error: updateError } = await adminClient
      .from('users')
      .update({
        first_name: 'Deleted',
        last_name: 'User',
        email: `deleted_user_${user.id}@deleted.local`,
        phone: null,
        is_lgbtq: null,
        is_goalie: false,
        tags: [],
        preferences: null,
        stripe_customer_id: null,
        stripe_setup_intent_id: null,
        stripe_payment_method_id: null,
        setup_intent_status: null,
        deleted_at: deletionTimestamp,
      })
      .eq('id', user.id)

    if (updateError) {
      logger.logSystem('account-deletion-mark-deleted-failed', 'Failed to mark user as deleted', { userId: user.id, error: updateError.message }, 'warn')
      captureCriticalAccountDeletionError(
        updateError,
        deletionErrorContext({ ...deletionContext, emailSent }, 'database_update')
      )
      return NextResponse.json({ error: 'Failed to complete account deletion' }, { status: 500 })
    }

    logger.logSystem('account-deletion-completed', 'Successfully deleted auth.users record while preserving anonymized business data', { userId: user.id })

    return NextResponse.json({
      success: true,
      message: 'Account successfully deleted'
    })

  } catch (error) {
    logger.logSystem('account-deletion-unexpected-error', 'Account deletion error', { userId: deletionContext.userId, error: error instanceof Error ? error.message : String(error) }, 'warn')

    // Capture critical error with all available context
    captureCriticalAccountDeletionError(
      error instanceof Error ? error : new Error(String(error)),
      deletionErrorContext(deletionContext, 'unknown')
    )

    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
