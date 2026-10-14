import { formatEventDateTime } from '@/lib/date-utils'

export type RegistrationTypeForLabel = 'team' | 'event' | 'scrimmage' | 'tournament' | string | null | undefined

/**
 * The "when" label for a registration, shared by RegistrationDateDisplay and
 * emails that need a season/date value.
 *
 * - event / scrimmage with a start date: the formatted event date/time
 * - otherwise (team registrations, or events missing a date): the season name
 *
 * Returns null when neither is available, so callers can decide what to do
 * instead of silently sending an empty string.
 */
export function getRegistrationDateLabel(input: {
  type: RegistrationTypeForLabel
  startDate?: string | null
  seasonName?: string | null
}): string | null {
  if ((input.type === 'event' || input.type === 'scrimmage') && input.startDate) {
    const formatted = formatEventDateTime(input.startDate)
    if (formatted && formatted !== 'N/A' && formatted !== 'Invalid Date') return formatted
  }
  const season = input.seasonName?.trim()
  return season ? season : null
}
