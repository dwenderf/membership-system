/**
 * Waitlist notification helpers
 *
 * Sends a confirmation email to the member when they are selected off a waitlist.
 * Called directly from the waitlist selection route after payment is confirmed.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email/service'

/**
 * Send a `waitlist.selected` confirmation email to the member who was selected.
 *
 * @param registrationId         - The registration the user was waitlisted for
 * @param userId                 - The user being selected off the waitlist
 * @param paymentId              - Payment ID (null for free/fully-discounted charges)
 * @param registrationCategoryId - The category they were waitlisted under
 * @param amountCharged          - Amount charged in cents
 */
export async function stageWaitlistSelectedEmail(
  registrationId: string,
  userId: string,
  paymentId: string | null,
  registrationCategoryId: string,
  amountCharged: number
): Promise<void> {
  if (!process.env.LOOPS_WAITLIST_SELECTED_TEMPLATE_ID) {
    console.warn('LOOPS_WAITLIST_SELECTED_TEMPLATE_ID not configured, skipping waitlist selected notification')
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
      console.error('stageWaitlistSelectedEmail: user not found', { userId, error: userError })
      return
    }

    // Fetch registration + season
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('name, season:seasons(name)')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      console.error('stageWaitlistSelectedEmail: registration not found', { registrationId, error: regError })
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
    })

  } catch (error) {
    console.error('stageWaitlistSelectedEmail: unexpected error', error)
    // Don't throw — notifications must never break the main flow
  }
}
