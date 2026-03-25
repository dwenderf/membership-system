/**
 * Admin notification helpers
 *
 * Notifies opted-in admins of:
 * - New registrations (regular + alternate sign-ups)
 * - Refunds processed
 *
 * Respects each admin's opt-out preferences:
 *   preferences.emailNotifications.newRegistrations  (default: opted in)
 *   preferences.emailNotifications.refunds           (default: opted in)
 */

import { createAdminClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/date-utils'
import { emailService } from '@/lib/email/service'

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Delay between sends — reuses the same env var as the batch cron (default 150ms) */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const getEmailDelayMs = () => {
  const val = parseInt(process.env.LOOPS_EMAIL_BATCH_DELAY_MS ?? '', 10)
  return isNaN(val) ? 150 : val
}

/** Returns all admins who have not opted out of a given notification key */
async function getOptedInAdmins(
  prefKey: 'newRegistrations' | 'refunds'
): Promise<Array<{ id: string; email: string; first_name: string; last_name: string }>> {
  const supabase = createAdminClient()

  const { data: admins, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, preferences')
    .eq('is_admin', true)

  if (error || !admins) {
    console.error('admin-notifications: failed to fetch admins', error)
    return []
  }

  return admins.filter((admin) => {
    const pref = (admin as any).preferences?.emailNotifications?.[prefKey]
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
    console.warn('LOOPS_ADMIN_NEW_REGISTRATION_TEMPLATE_ID not configured, skipping admin new-registration notification')
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
      console.error('stageAdminNewRegistrationNotification: registration not found', { registrationId, error: regError })
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
      console.error('stageAdminNewRegistrationNotification: player not found', { playerUserId, error: playerError })
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
    console.error('stageAdminNewRegistrationNotification: unexpected error', error)
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
    console.warn('LOOPS_ADMIN_REFUND_TEMPLATE_ID not configured, skipping admin refund notification')
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
      console.error('stageAdminRefundNotification: player not found', { playerUserId, error: playerError })
      return
    }

    const playerName = `${player.first_name} ${player.last_name}`

    // Resolve the registration name from the refunded payment
    const { data: userReg } = await supabase
      .from('user_registrations')
      .select('registration:registrations(name, season:seasons(name))')
      .eq('payment_id', paymentId)
      .eq('user_id', playerUserId)
      .single()

    const reg = userReg?.registration
      ? (Array.isArray(userReg.registration) ? userReg.registration[0] : userReg.registration)
      : null
    const registrationName = reg?.name ?? 'Registration'
    const regSeason = reg?.season ? (Array.isArray(reg.season) ? reg.season[0] : reg.season) : null
    const seasonName = regSeason?.name ?? ''

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
    console.error('stageAdminRefundNotification: unexpected error', error)
    // Don't throw — notifications must never break the main flow
  }
}
