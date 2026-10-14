/**
 * Resolve what a refunded payment was for, so refund emails (admin + member)
 * can carry real `registrationName` / `seasonName` values instead of empty
 * strings or generic fallbacks (Loops rejects empty required variables).
 *
 * Lookup order for the payment:
 *   1. user_registrations.payment_id  -> registration (team/event/scrimmage)
 *   2. alternate_selections.payment_id -> alternate game on a registration
 *   3. user_memberships.payment_id     -> membership purchase
 *
 * seasonName follows getRegistrationDateLabel(): the season name for team
 * registrations, the event/scrimmage date for events and scrimmages. For an
 * alternate selection on an event/scrimmage the selected game's date is used.
 * For memberships, seasonName is the membership validity end date.
 *
 * Returns null when nothing matches; callers decide what to do (see callers).
 */

import { createAdminClient } from '@/lib/supabase/server'
import { getRegistrationDateLabel } from '@/lib/registration-date-label'

export interface RefundEmailContext {
  registrationName: string
  seasonName: string
  source: 'registration' | 'alternate' | 'membership'
}

type AdminClient = ReturnType<typeof createAdminClient>

interface RegistrationShape {
  name: string | null
  type: string | null
  start_date: string | null
  season: { name: string | null } | { name: string | null }[] | null
}

const one = <T>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v

function fromRegistration(reg: RegistrationShape | null, startDateOverride?: string | null): Omit<RefundEmailContext, 'source'> | null {
  if (!reg) return null
  const registrationName = reg.name?.trim()
  const seasonName = getRegistrationDateLabel({
    type: reg.type,
    startDate: startDateOverride ?? reg.start_date,
    seasonName: one(reg.season)?.name,
  })
  if (!registrationName || !seasonName) return null
  return { registrationName, seasonName }
}

/**
 * Format a DATE column (YYYY-MM-DD) as M/D/YYYY with no timezone conversion.
 * (formatDateString builds a local-midnight Date and then formats it in
 * America/New_York, which shifts it a day back on UTC hosts such as Vercel.)
 */
function formatDateOnly(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return y && m && d ? `${m}/${d}/${y}` : value
}

const REG_SELECT = 'name, type, start_date, season:seasons(name)'

export async function resolveRefundEmailContext(
  supabase: AdminClient,
  userId: string,
  paymentId: string
): Promise<RefundEmailContext | null> {
  const { data: userReg } = await supabase
    .from('user_registrations')
    .select(`registration:registrations(${REG_SELECT})`)
    .eq('payment_id', paymentId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  const regCtx = fromRegistration(one(userReg?.registration as RegistrationShape | RegistrationShape[] | null))
  if (regCtx) return { ...regCtx, source: 'registration' }

  const { data: altSel } = await supabase
    .from('alternate_selections')
    .select(`alternate_registration:alternate_registrations(game_date, registration:registrations(${REG_SELECT}))`)
    .eq('payment_id', paymentId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  const altReg = one(altSel?.alternate_registration as
    | { game_date: string | null; registration: RegistrationShape | RegistrationShape[] | null }
    | { game_date: string | null; registration: RegistrationShape | RegistrationShape[] | null }[]
    | null)
  const altCtx = fromRegistration(one(altReg?.registration), altReg?.game_date)
  if (altCtx) return { ...altCtx, source: 'alternate' }

  const { data: userMembership } = await supabase
    .from('user_memberships')
    .select('valid_until, membership:memberships(name)')
    .eq('payment_id', paymentId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  const membershipName = one(userMembership?.membership as { name: string | null } | { name: string | null }[] | null)?.name?.trim()
  if (membershipName && userMembership?.valid_until) {
    return {
      registrationName: membershipName,
      seasonName: `Valid through ${formatDateOnly(userMembership.valid_until)}`,
      source: 'membership',
    }
  }

  return null
}
