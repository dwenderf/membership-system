import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server-client'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { logger } from '@/lib/logging/logger'
import { clearSavedPaymentMethod } from '@/lib/services/saved-payment-method-cleanup'

export async function DELETE() {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check for outstanding payment plan balances
    const hasOutstanding = await PaymentPlanService.hasOutstandingBalance(user.id)

    if (hasOutstanding) {
      const totalOutstanding = await PaymentPlanService.getTotalOutstandingBalance(user.id)

      logger.logPaymentProcessing(
        'payment-method-removal-blocked',
        'Payment method removal blocked due to outstanding payment plan balance',
        {
          userId: user.id,
          outstandingAmount: totalOutstanding
        },
        'info'
      )

      return NextResponse.json({
        error: 'Cannot remove payment method with outstanding payment plan balance',
        requiresPayoff: true,
        outstandingAmount: totalOutstanding
      }, { status: 400 })
    }

    // Get user's payment method info
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('stripe_payment_method_id')
      .eq('id', user.id)
      .single()

    if (!userProfile?.stripe_payment_method_id) {
      return NextResponse.json({ error: 'No payment method found' }, { status: 404 })
    }

    // Detach payment method from Stripe
    const paymentMethodId = userProfile.stripe_payment_method_id
    const detached = await detachOrConfirmAlreadyDetached(paymentMethodId, user.id)

    logger.logPaymentProcessing(
      'payment-method-removed',
      'Successfully removed payment method',
      { userId: user.id },
      'info'
    )

    // Clear DB fields, remove alternates and stage the removal email now, so the
    // client's refetch sees the removal. The payment_method.detached webhook is an
    // idempotent backstop (it won't re-send the email once this has cleared the row).
    await clearSavedPaymentMethod({
      supabase: adminSupabase,
      paymentMethodId,
      userId: user.id,
      last4: detached.card?.last4,
      source: 'remove-route',
    })

    return NextResponse.json({ success: true, paymentMethod: null })

  } catch (error) {
    logger.logPaymentProcessing(
      'payment-method-removal-error',
      'Error removing payment method',
      {
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
/**
 * Detach the card. If Stripe rejects the detach because the card is no longer attached
 * (e.g. an earlier attempt detached it but the DB clear failed), confirm that by
 * retrieving it (customer: null, or resource_missing) and treat it as success so the
 * DB clear can run on retry. Any other error is rethrown and the DB is left unchanged.
 */
async function detachOrConfirmAlreadyDetached(
  paymentMethodId: string,
  userId: string
): Promise<{ card?: { last4?: string | null } | null }> {
  const stripe = getStripe()
  try {
    return await stripe.paymentMethods.detach(paymentMethodId)
  } catch (detachError) {
    if (!isStripeInvalidRequest(detachError)) throw detachError

    let alreadyDetached = false
    let card: { last4?: string | null } | null = null
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
      alreadyDetached = pm.customer == null
      card = pm.card ?? null
    } catch (retrieveError) {
      alreadyDetached = stripeErrorCode(retrieveError) === 'resource_missing'
    }
    if (!alreadyDetached) throw detachError

    logger.logPaymentProcessing(
      'payment-method-already-detached',
      'Payment method was already detached in Stripe; clearing DB',
      { userId, code: stripeErrorCode(detachError) },
      'warn'
    )
    return { card }
  }
}

function stripeErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

function isStripeInvalidRequest(error: unknown): boolean {
  const e = error as { type?: string; code?: string } | null
  return e?.type === 'StripeInvalidRequestError' || e?.code === 'resource_missing'
}
