import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging/logger'

export interface ClearSavedPaymentMethodParams {
  /** Service-role client: this clears card fields and deletes alternates */
  supabase: SupabaseClient
  paymentMethodId: string
  /** Set by /api/remove-payment-method. Omitted by the webhook (looked up by card id). */
  userId?: string
  /** Last 4 digits for the removal email, if known */
  last4?: string | null
  source: 'remove-route' | 'webhook'
}

export interface ClearSavedPaymentMethodResult {
  /** True only for the call that actually cleared the DB row (and staged the email) */
  cleared: boolean
  userId: string | null
}

/**
 * Clear a user's saved payment method after it has been detached in Stripe.
 *
 * Shared by /api/remove-payment-method (synchronous, so an immediate refetch sees
 * the removal) and the payment_method.detached webhook (backstop, and the path for
 * removals made outside the app, e.g. in the Stripe Dashboard).
 *
 * Idempotent and email-deduplicating: the clear is one conditional UPDATE filtered
 * by user id AND stripe_payment_method_id = paymentMethodId. Only the caller whose
 * UPDATE actually matches a row goes on to delete alternates and stage the
 * "Payment Method Removed" email. A later (or concurrent) call matches zero rows
 * and returns { cleared: false } without error or email. A detach of some other,
 * non-current card never matches, so it doesn't touch the current card.
 */
export async function clearSavedPaymentMethod(
  params: ClearSavedPaymentMethodParams
): Promise<ClearSavedPaymentMethodResult> {
  const { supabase, paymentMethodId, last4, source } = params

  let query = supabase
    .from('users')
    .update({
      stripe_payment_method_id: null,
      stripe_setup_intent_id: null,
      setup_intent_status: null,
      payment_method_updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_method_id', paymentMethodId)
  if (params.userId) {
    query = query.eq('id', params.userId)
  }

  const { data: clearedRows, error: updateError } = await query.select('id, first_name, last_name, email')
  if (updateError) {
    throw updateError
  }

  const user = clearedRows?.[0] as
    | { id: string; first_name: string | null; last_name: string | null; email: string }
    | undefined
  if (!user) {
    // Already cleared (e.g. the remove route ran before this webhook), or not a saved card
    return { cleared: false, userId: params.userId ?? null }
  }

  const { error: alternateRemovalError } = await supabase
    .from('user_alternate_registrations')
    .delete()
    .eq('user_id', user.id)

  if (alternateRemovalError) {
    logger.logPaymentProcessing('payment-method-detached-alternate-removal-failed', 'Failed to remove user from alternate registrations', { userId: user.id, source, error: alternateRemovalError.message }, 'warn')
    // Not critical - don't throw
  }

  if (process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID) {
    const { emailStagingManager } = await import('@/lib/email/staging')
    await emailStagingManager.stageEmail({
      user_id: user.id,
      email_address: user.email,
      event_type: 'payment_method.removed',
      subject: 'Payment Method Removed',
      template_id: process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID,
      email_data: {
        userName: `${user.first_name} ${user.last_name}`,
        paymentMethod: `****${last4 || '****'}`,
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user`,
      },
    })
  }

  logger.logPaymentProcessing('payment-method-detached-cleaned-up', 'Cleared saved payment method', {
    userId: user.id,
    paymentMethodId,
    source,
  }, 'info')

  return { cleared: true, userId: user.id }
}
