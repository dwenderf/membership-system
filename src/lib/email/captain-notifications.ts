/**
 * Captain roster change notification helper
 *
 * Notifies captains when their roster changes (player joined, left,
 * selected from waitlist, or registered as alternate).
 * Respects the captain's `preferences.emailNotifications.rosterChanges` opt-out preference.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/date-utils'
import { emailService } from '@/lib/email/service'

export type RosterChangeType =
  | 'joined'
  | 'left'
  | 'selected from waitlist'
  | 'alternate joined'

/**
 * Notify all opted-in captains of a registration when a roster change occurs.
 *
 * @param registrationId - The registration the change belongs to
 * @param playerUserId   - The player who changed roster status
 * @param changeType     - Human-readable description of the change
 * @param categoryName   - Category name (use "Alternate" for alternate signups)
 * @param registeredAt   - ISO timestamp of when the change occurred
 * @param amountPaid     - Amount paid in cents (0 for alternates, free, etc.)
 */
export async function stageCaptainRosterChangeNotification(
  registrationId: string,
  playerUserId: string,
  changeType: RosterChangeType,
  categoryName: string,
  registeredAt: string,
  amountPaid: number
): Promise<void> {
  if (!process.env.LOOPS_CAPTAIN_ROSTER_CHANGE_TEMPLATE_ID) {
    console.warn('LOOPS_CAPTAIN_ROSTER_CHANGE_TEMPLATE_ID not configured, skipping captain notification')
    return
  }

  try {
    const supabase = createAdminClient()

    // Fetch registration + season details
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, name, season:seasons(name)')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      console.error('stageCaptainRosterChangeNotification: registration not found', { registrationId, error: regError })
      return
    }

    const season = Array.isArray(registration.season) ? registration.season[0] : registration.season
    const registrationName = registration.name
    const seasonName = season?.name ?? ''

    // Fetch player details
    const { data: player, error: playerError } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', playerUserId)
      .single()

    if (playerError || !player) {
      console.error('stageCaptainRosterChangeNotification: player not found', { playerUserId, error: playerError })
      return
    }

    const playerName = `${player.first_name} ${player.last_name}`

    // Fetch all captains for this registration
    const { data: captainRows, error: captainError } = await supabase
      .from('registration_captains')
      .select('user_id, users(id, first_name, last_name, email, preferences)')
      .eq('registration_id', registrationId)

    if (captainError) {
      console.error('stageCaptainRosterChangeNotification: error fetching captains', { registrationId, error: captainError })
      return
    }

    if (!captainRows || captainRows.length === 0) {
      // No captains assigned — nothing to notify
      return
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''
    const rosterUrl = `${siteUrl}/user/captain/${registrationId}/roster`
    const registrationDateTime = formatDateTime(registeredAt)
    const paidAmount = `$${(amountPaid / 100).toFixed(2)}`

    // Notify each opted-in captain
    for (const row of captainRows) {
      const captain = Array.isArray(row.users) ? row.users[0] : row.users
      if (!captain) continue

      // Check opt-out preference (absent = opted in)
      const prefs = (captain as any).preferences ?? {}
      const rosterChangePref = prefs?.emailNotifications?.rosterChanges
      if (rosterChangePref === false) continue

      // Skip notifying a captain about their own roster action
      if (captain.id === playerUserId) continue

      await emailService.sendCaptainRosterChangeNotification({
        captainUserId: captain.id,
        captainEmail: captain.email,
        captainName: `${captain.first_name} ${captain.last_name}`,
        playerName,
        registrationName,
        seasonName,
        categoryName,
        changeType,
        registrationDateTime,
        paidAmount,
        rosterUrl,
      })
    }

  } catch (error) {
    console.error('stageCaptainRosterChangeNotification: unexpected error', error)
    // Don't throw — notifications must never break the main flow
  }
}
