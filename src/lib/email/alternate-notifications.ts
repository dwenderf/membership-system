/**
 * Alternate notification helpers
 *
 * Sends a confirmation email to the member when they sign up as an alternate
 * for a registration (#397). Called from the alternate sign-up route inside
 * runAfterResponse(), alongside the captain/admin notifications.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email/service'
import { logger } from '@/lib/logging/logger'

/**
 * Send an `alternate.registered` confirmation email to the member who signed up.
 *
 * Always sent (not gated on email preferences). If the Loops template ID is
 * not configured, logs a warning and skips — registration is never affected.
 *
 * @param registrationId - The registration the user signed up as an alternate for
 * @param userId         - The member who signed up
 * @param registeredAt   - ISO timestamp of the alternate sign-up
 */
export async function stageAlternateRegistrationConfirmationEmail(
  registrationId: string,
  userId: string,
  registeredAt: string
): Promise<void> {
  if (!process.env.LOOPS_ALTERNATE_REGISTRATION_CONFIRMATION_TEMPLATE_ID) {
    logger.logSystem(
      'alternate-registration-confirmation-template-missing',
      'LOOPS_ALTERNATE_REGISTRATION_CONFIRMATION_TEMPLATE_ID not configured, skipping alternate registration confirmation',
      { registrationId, userId },
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
        'alternate-registration-confirmation-user-not-found',
        'stageAlternateRegistrationConfirmationEmail: user not found',
        { userId, error: userError?.message },
        'error'
      )
      return
    }

    // Fetch registration + season
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('name, alternate_price, season:seasons(name)')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      logger.logSystem(
        'alternate-registration-confirmation-registration-not-found',
        'stageAlternateRegistrationConfirmationEmail: registration not found',
        { registrationId, error: regError?.message },
        'error'
      )
      return
    }

    const season = Array.isArray(registration.season) ? registration.season[0] : registration.season
    const seasonName = season?.name ?? ''

    const result = await emailService.sendAlternateRegistrationConfirmation({
      userId: user.id,
      email: user.email,
      userName: `${user.first_name} ${user.last_name}`,
      registrationName: registration.name,
      seasonName,
      registeredAt,
      alternatePrice: registration.alternate_price ?? 0,
    })

    if (!result.success) {
      // IDs only (no email/name). The service has already written the
      // email_logs row (failed, or pending for cron retry on transient errors).
      logger.logSystem(
        'alternate-registration-confirmation-send-failed',
        'stageAlternateRegistrationConfirmationEmail: send reported failure (non-fatal)',
        { registrationId, userId, reason: result.error },
        'warn'
      )
    }

  } catch (error) {
    logger.logSystem(
      'alternate-registration-confirmation-unexpected-error',
      'stageAlternateRegistrationConfirmationEmail: unexpected error',
      { registrationId, userId, error: error instanceof Error ? error.message : String(error) },
      'error',
      error
    )
    // Don't throw — notifications must never break the main flow
  }
}
