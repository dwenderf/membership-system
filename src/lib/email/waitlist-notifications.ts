/**
 * Waitlist notification helpers
 *
 * Sends a confirmation email to the member when they are selected off a waitlist.
 * Called directly from the waitlist selection route after payment is confirmed.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email/service'
import { logger } from '@/lib/logging/logger'
import { calculateNextInstallmentDate } from '@/lib/payment-plan-utils'
import { PAYMENT_PLAN_INSTALLMENTS, INSTALLMENT_INTERVAL_DAYS } from '@/lib/services/payment-plan-config'
import { formatDate } from '@/lib/date-utils'

export interface WaitlistSelectedPaymentPlanDetails {
  /** amountCharged is installment 1 of a payment plan. */
  isPaymentPlan: boolean
  /** Full amount after discounts (the plan total when isPaymentPlan). */
  totalAmount: number
  /** Member chose a plan but was no longer eligible, so they were charged in full. */
  paymentPlanFallback: boolean
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * One- or two-sentence `paymentPlanInfo` for the waitlist-selected email (#442), so the template can
 * show it as-is with a single conditional. Describes the plan when this charge started one, explains
 * the full charge when the member chose a plan but was no longer eligible, and is blank otherwise.
 * Quotes the remaining balance rather than a per-installment amount, since the last installment
 * absorbs any rounding.
 */
export function buildWaitlistPaymentPlanInfo(
  amountCharged: number,
  paymentPlan: WaitlistSelectedPaymentPlanDetails | undefined,
  chargedAt: Date = new Date()
): string {
  if (paymentPlan?.paymentPlanFallback) {
    return (
      `You chose a payment plan when you joined the waitlist, but your account is no longer set up ` +
      `for payment plans, so the full ${dollars(amountCharged)} was charged today. ` +
      `If you have questions, please contact us.`
    )
  }
  if (!paymentPlan?.isPaymentPlan) return ''
  const remainingInstallments = PAYMENT_PLAN_INSTALLMENTS - 1
  const remainingBalance = paymentPlan.totalAmount - amountCharged
  return (
    `You're on a payment plan for ${dollars(paymentPlan.totalAmount)}: today's charge of ${dollars(amountCharged)} ` +
    `is payment 1 of ${PAYMENT_PLAN_INSTALLMENTS}. The remaining ${dollars(remainingBalance)} will be charged to your ` +
    `saved card in ${remainingInstallments} payments, every ${INSTALLMENT_INTERVAL_DAYS} days starting ` +
    `${formatDate(calculateNextInstallmentDate(chargedAt))}.`
  )
}

/**
 * Send a `waitlist.selected` confirmation email to the member who was selected.
 *
 * @param registrationId         - The registration the user was waitlisted for
 * @param userId                 - The user being selected off the waitlist
 * @param paymentId              - Payment ID (null for free/fully-discounted charges)
 * @param registrationCategoryId - The category they were waitlisted under
 * @param amountCharged          - Amount charged in cents (installment 1 for a payment plan)
 * @param paymentPlan            - Payment-plan details for the template's plan/fallback copy (#442)
 */
export async function stageWaitlistSelectedEmail(
  registrationId: string,
  userId: string,
  paymentId: string | null,
  registrationCategoryId: string,
  amountCharged: number,
  paymentPlan?: WaitlistSelectedPaymentPlanDetails
): Promise<void> {
  if (!process.env.LOOPS_WAITLIST_SELECTED_TEMPLATE_ID) {
    logger.logSystem(
      'waitlist-selected-template-missing',
      'LOOPS_WAITLIST_SELECTED_TEMPLATE_ID not configured, skipping waitlist selected notification',
      undefined,
      'warn'
    )
    return
  }

  try {
    const supabase = createAdminClient()

    // Fetch user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      logger.logSystem(
        'waitlist-selected-user-not-found',
        'stageWaitlistSelectedEmail: user not found',
        { userId, error: userError?.message },
        'error'
      )
      return
    }

    // Fetch registration + season
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('name, season:seasons(name)')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      logger.logSystem(
        'waitlist-selected-registration-not-found',
        'stageWaitlistSelectedEmail: registration not found',
        { registrationId, error: regError?.message },
        'error'
      )
      return
    }

    const season = Array.isArray(registration.season) ? registration.season[0] : registration.season
    const seasonName = season?.name ?? ''

    // Resolve category name
    const { data: regCategory } = await supabase
      .from('registration_categories')
      .select('custom_name, category:categories(name)')
      .eq('id', registrationCategoryId)
      .single()

    const masterCategory = regCategory?.category
      ? (Array.isArray(regCategory.category) ? regCategory.category[0] : regCategory.category)
      : null
    const categoryName = regCategory?.custom_name || masterCategory?.name || 'Standard'

    // Resolve payment intent ID if a payment exists
    let paymentIntentId: string | undefined
    if (paymentId) {
      const { data: payment } = await supabase
        .from('payments')
        .select('stripe_payment_intent_id')
        .eq('id', paymentId)
        .single()
      paymentIntentId = payment?.stripe_payment_intent_id ?? undefined
    }

    await emailService.sendWaitlistSelectedNotification({
      userId: user.id,
      email: user.email,
      userName: `${user.first_name} ${user.last_name}`,
      registrationName: registration.name,
      categoryName,
      seasonName,
      amountCharged,
      paymentIntentId,
      paymentPlanInfo: buildWaitlistPaymentPlanInfo(amountCharged, paymentPlan),
    })

  } catch (error) {
    logger.logSystem(
      'waitlist-selected-unexpected-error',
      'stageWaitlistSelectedEmail: unexpected error',
      { registrationId, userId, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    // Don't throw — notifications must never break the main flow
  }
}

/**
 * Send a `waitlist.removed` confirmation email to the member who was removed
 * from a waitlist. Used uniformly whether the removal was self-service,
 * captain-initiated, or admin-initiated — the template does not vary by actor.
 *
 * @param registrationId         - The registration the user was waitlisted for
 * @param userId                 - The user being removed from the waitlist
 * @param registrationCategoryId - The category they were waitlisted under
 */
export async function stageWaitlistRemovedEmail(
  registrationId: string,
  userId: string,
  registrationCategoryId: string
): Promise<void> {
  if (!process.env.LOOPS_WAITLIST_REMOVED_TEMPLATE_ID) {
    logger.logSystem(
      'waitlist-removed-template-missing',
      'LOOPS_WAITLIST_REMOVED_TEMPLATE_ID not configured, skipping waitlist removed notification',
      undefined,
      'warn'
    )
    return
  }

  try {
    const supabase = createAdminClient()

    // Fetch user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      logger.logSystem(
        'waitlist-removed-user-not-found',
        'stageWaitlistRemovedEmail: user not found',
        { userId, error: userError?.message },
        'error'
      )
      return
    }

    // Fetch registration + season
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('name, season:seasons(name)')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      logger.logSystem(
        'waitlist-removed-registration-not-found',
        'stageWaitlistRemovedEmail: registration not found',
        { registrationId, error: regError?.message },
        'error'
      )
      return
    }

    const season = Array.isArray(registration.season) ? registration.season[0] : registration.season
    const seasonName = season?.name ?? ''

    // Resolve category name
    const { data: regCategory } = await supabase
      .from('registration_categories')
      .select('custom_name, category:categories(name)')
      .eq('id', registrationCategoryId)
      .single()

    const masterCategory = regCategory?.category
      ? (Array.isArray(regCategory.category) ? regCategory.category[0] : regCategory.category)
      : null
    const categoryName = regCategory?.custom_name || masterCategory?.name || 'Standard'

    await emailService.sendWaitlistRemovedNotification({
      userId: user.id,
      email: user.email,
      userName: `${user.first_name} ${user.last_name}`,
      registrationName: registration.name,
      categoryName,
      seasonName,
    })

  } catch (error) {
    logger.logSystem(
      'waitlist-removed-unexpected-error',
      'stageWaitlistRemovedEmail: unexpected error',
      { registrationId, userId, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    // Don't throw — notifications must never break the main flow
  }
}
