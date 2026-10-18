/**
 * Admin notification helpers
 *
 * Notifies opted-in admins of:
 * - New registrations (regular + alternate sign-ups)
 * - Refunds processed
 * - Payment plan installments that fail to charge
 *
 * Respects each admin's opt-out preferences:
 *   preferences.emailNotifications.newRegistrations  (default: opted in)
 *   preferences.emailNotifications.refunds           (default: opted in)
 *   preferences.emailNotifications.paymentPlanFailures (default: opted in)
 */

import { createAdminClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/date-utils'
import { emailService } from '@/lib/email/service'
import { resolveRefundEmailContext } from '@/lib/email/refund-context'
import { logger } from '@/lib/logging/logger'

/** The slice of a user's `preferences` jsonb blob this module reads —
 * not the full shape (which also holds unrelated keys like adminFavorites). */
interface UserEmailPreferences {
  emailNotifications?: {
    newRegistrations?: boolean
    refunds?: boolean
    paymentPlanFailures?: boolean
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Delay between sends — reuses the same env var as the batch cron (default 150ms) */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const getEmailDelayMs = () => {
  const val = parseInt(process.env.LOOPS_EMAIL_BATCH_DELAY_MS ?? '', 10)
  return isNaN(val) ? 150 : val
}

/** Returns all admins who have not opted out of a given notification key */
async function getOptedInAdmins(
  prefKey: 'newRegistrations' | 'refunds' | 'paymentPlanFailures'
): Promise<Array<{ id: string; email: string; first_name: string; last_name: string }>> {
  const supabase = createAdminClient()

  const { data: admins, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, preferences')
    .eq('is_admin', true)

  if (error || !admins) {
    logger.logAdminAction(
      'admin-notifications-fetch-admins-failed',
      'admin-notifications: failed to fetch admins',
      { error: error?.message },
      undefined,
      'error'
    )
    return []
  }

  return admins.filter((admin) => {
    const pref = (admin.preferences as UserEmailPreferences | null)?.emailNotifications?.[prefKey]
    return pref !== false // absent or true = opted in
  })
}

// ─── New registration notification ────────────────────────────────────────────

/**
 * Notify opted-in admins when a new registration (regular or alternate) is created.
 *
 * @param registrationId         - The registration the user joined
 * @param playerUserId           - The newly registered user
 * @param paymentId              - Payment ID (null for free alternates — no invoice yet)
 * @param registrationCategoryId - Category ID (null for alternate sign-ups)
 * @param isAlternate            - Whether this is an alternate sign-up (no category/no payment)
 * @param registeredAt           - ISO timestamp of the registration
 * @param amountPaid             - Amount paid in cents (0 for alternates)
 */
export async function stageAdminNewRegistrationNotification(
  registrationId: string,
  playerUserId: string,
  paymentId: string | null,
  registrationCategoryId: string | null,
  isAlternate: boolean,
  registeredAt: string,
  amountPaid: number
): Promise<void> {
  if (!process.env.LOOPS_ADMIN_NEW_REGISTRATION_TEMPLATE_ID) {
    logger.logAdminAction(
      'admin-new-registration-template-missing',
      'LOOPS_ADMIN_NEW_REGISTRATION_TEMPLATE_ID not configured, skipping admin new-registration notification',
      undefined,
      undefined,
      'warn'
    )
    return
  }

  try {
    const supabase = createAdminClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

    // Fetch registration + season
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, name, season:seasons(name)')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      logger.logAdminAction(
        'admin-new-registration-registration-not-found',
        'stageAdminNewRegistrationNotification: registration not found',
        { registrationId, error: regError?.message },
        undefined,
        'error'
      )
      return
    }

    const season = Array.isArray(registration.season) ? registration.season[0] : registration.season
    const registrationName = registration.name
    const seasonName = season?.name ?? ''

    // Resolve category name
    let categoryName = 'Alternate'
    if (!isAlternate && registrationCategoryId) {
      const { data: regCategory } = await supabase
        .from('registration_categories')
        .select('custom_name, category:categories(name)')
        .eq('id', registrationCategoryId)
        .single()

      if (regCategory) {
        const masterCategory = Array.isArray(regCategory.category) ? regCategory.category[0] : regCategory.category
        categoryName = regCategory.custom_name || masterCategory?.name || 'Standard'
      }
    }

    // Fetch player details
    const { data: player, error: playerError } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('id', playerUserId)
      .single()

    if (playerError || !player) {
      logger.logAdminAction(
        'admin-new-registration-player-not-found',
        'stageAdminNewRegistrationNotification: player not found',
        { playerUserId, error: playerError?.message },
        undefined,
        'error'
      )
      return
    }

    const playerName = `${player.first_name} ${player.last_name}`
    const registrationDateTime = formatDateTime(registeredAt)
    const paidAmount = `$${(amountPaid / 100).toFixed(2)}`
    const rosterUrl = `${siteUrl}/admin/reports/registrations/${registrationId}`

    // For paid registrations, link directly to the invoice.
    // For alternates (no upfront payment), fall back to the user's admin
    // profile page — the admin can navigate to invoices from there.
    const invoiceUrl = paymentId
      ? `${siteUrl}/admin/reports/users/${playerUserId}/invoices/${paymentId}`
      : `${siteUrl}/admin/reports/users/${playerUserId}`

    const admins = await getOptedInAdmins('newRegistrations')
    const delayMs = getEmailDelayMs()

    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i]
      await emailService.sendAdminNewRegistrationNotification({
        adminUserId: admin.id,
        adminEmail: admin.email,
        adminName: `${admin.first_name} ${admin.last_name}`,
        playerName,
        registrationName,
        seasonName,
        categoryName,
        registrationDateTime,
        paidAmount,
        invoiceUrl,
        rosterUrl,
      })
      if (i < admins.length - 1) await delay(delayMs)
    }

  } catch (error) {
    logger.logAdminAction(
      'admin-new-registration-unexpected-error',
      'stageAdminNewRegistrationNotification: unexpected error',
      { registrationId, playerUserId, error: error instanceof Error ? error.message : String(error) },
      undefined,
      'error'
    )
    // Don't throw — notifications must never break the main flow
  }
}

// ─── Refund notification ───────────────────────────────────────────────────────

/**
 * Notify opted-in admins when a refund is processed.
 *
 * @param playerUserId     - The user who received the refund
 * @param paymentId        - The original payment ID
 * @param refundAmountCents  - Refund amount in cents
 * @param originalAmountCents - Original payment amount in cents
 */
export async function stageAdminRefundNotification(
  playerUserId: string,
  paymentId: string,
  refundAmountCents: number,
  originalAmountCents: number
): Promise<void> {
  if (!process.env.LOOPS_ADMIN_REFUND_TEMPLATE_ID) {
    logger.logAdminAction(
      'admin-refund-template-missing',
      'LOOPS_ADMIN_REFUND_TEMPLATE_ID not configured, skipping admin refund notification',
      undefined,
      undefined,
      'warn'
    )
    return
  }

  try {
    const supabase = createAdminClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

    // Fetch player details
    const { data: player, error: playerError } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', playerUserId)
      .single()

    if (playerError || !player) {
      logger.logAdminAction(
        'admin-refund-player-not-found',
        'stageAdminRefundNotification: player not found',
        { playerUserId, error: playerError?.message },
        undefined,
        'error'
      )
      return
    }

    const playerName = `${player.first_name} ${player.last_name}`

    // Resolve what was refunded. Loops rejects empty required variables, and a
    // generic "Registration" label is useless to admins, so if we can't find the
    // item we skip the admin email and report it (Sentry via logger 'error')
    // rather than stage an email that can never send correctly.
    const context = await resolveRefundEmailContext(supabase, playerUserId, paymentId)
    if (!context) {
      logger.logAdminAction(
        'admin-refund-context-missing',
        'stageAdminRefundNotification: could not resolve registration/season for refunded payment; admin refund email not staged',
        { playerUserId, paymentId },
        undefined,
        'error'
      )
      return
    }
    const { registrationName, seasonName } = context

    const refundAmount = (refundAmountCents / 100).toFixed(2)
    const originalAmount = (originalAmountCents / 100).toFixed(2)
    const invoiceUrl = `${siteUrl}/admin/reports/users/${playerUserId}/invoices/${paymentId}`

    const admins = await getOptedInAdmins('refunds')
    const delayMs = getEmailDelayMs()

    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i]
      await emailService.sendAdminRefundNotification({
        adminUserId: admin.id,
        adminEmail: admin.email,
        adminName: `${admin.first_name} ${admin.last_name}`,
        playerName,
        registrationName,
        seasonName,
        refundAmount,
        originalAmount,
        invoiceUrl,
      })
      if (i < admins.length - 1) await delay(delayMs)
    }

  } catch (error) {
    logger.logAdminAction(
      'admin-refund-unexpected-error',
      'stageAdminRefundNotification: unexpected error',
      { playerUserId, paymentId, error: error instanceof Error ? error.message : String(error) },
      undefined,
      'error'
    )
    // Don't throw — notifications must never break the main flow
  }
}

// ─── Payment plan failure notification ─────────────────────────────────────────

/**
 * Notify opted-in admins when a payment plan installment fails to charge.
 * Sent on every failed attempt so admins hear about it on the first failure,
 * not only after automatic retries run out.
 */
export async function stageAdminPaymentPlanFailureNotification(options: {
  playerUserId: string
  registrationName: string
  seasonName: string
  installmentNumber: number
  totalInstallments: number
  installmentAmountCents: number
  failureReason: string
  attemptNumber: number
  maxAttempts: number
}): Promise<void> {
  if (!process.env.LOOPS_ADMIN_PAYMENT_PLAN_FAILURE_TEMPLATE_ID) {
    logger.logAdminAction(
      'admin-payment-plan-failure-template-missing',
      'LOOPS_ADMIN_PAYMENT_PLAN_FAILURE_TEMPLATE_ID not configured, skipping admin payment plan failure notification',
      undefined,
      undefined,
      'warn'
    )
    return
  }

  try {
    const supabase = createAdminClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

    const { data: player, error: playerError } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', options.playerUserId)
      .single()

    if (playerError || !player) {
      logger.logAdminAction(
        'admin-payment-plan-failure-player-not-found',
        'stageAdminPaymentPlanFailureNotification: player not found',
        { playerUserId: options.playerUserId, error: playerError?.message },
        undefined,
        'error'
      )
      return
    }

    const retriesLeft = options.maxAttempts - options.attemptNumber
    const attemptSummary = retriesLeft > 0
      ? `Attempt ${options.attemptNumber} of ${options.maxAttempts} failed. ${retriesLeft} automatic ${retriesLeft === 1 ? 'retry' : 'retries'} remaining.`
      : `Attempt ${options.attemptNumber} of ${options.maxAttempts} failed. Automatic retries are exhausted: once the member has updated their card, use Run Payments on the Payment Plans report to charge it again.`

    const admins = await getOptedInAdmins('paymentPlanFailures')
    const delayMs = getEmailDelayMs()

    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i]
      await emailService.sendAdminPaymentPlanFailureNotification({
        adminUserId: admin.id,
        adminEmail: admin.email,
        adminName: `${admin.first_name} ${admin.last_name}`,
        playerName: `${player.first_name} ${player.last_name}`,
        registrationName: options.registrationName,
        seasonName: options.seasonName,
        installmentNumber: options.installmentNumber,
        totalInstallments: options.totalInstallments,
        installmentAmount: `$${(options.installmentAmountCents / 100).toFixed(2)}`,
        failureReason: options.failureReason,
        attemptSummary,
        userUrl: `${siteUrl}/admin/reports/users/${options.playerUserId}`,
      })
      if (i < admins.length - 1) await delay(delayMs)
    }
  } catch (error) {
    logger.logAdminAction(
      'admin-payment-plan-failure-unexpected-error',
      'stageAdminPaymentPlanFailureNotification: unexpected error',
      { playerUserId: options.playerUserId, error: error instanceof Error ? error.message : String(error) },
      undefined,
      'error'
    )
    // Don't throw — notifications must never break the main flow
  }
}
