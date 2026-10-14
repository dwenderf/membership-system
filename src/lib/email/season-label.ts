import { formatDateString } from '@/lib/date-utils'

/**
 * "Fall/Winter 2026 (9/1/2026 - 3/31/2027)" for emails. Season start/end are
 * DATE columns, so they go through formatDateString (no timezone shift, #410).
 */
export function formatSeasonWithDates(
  season: { name: string; start_date: string; end_date: string } | null | undefined
): string {
  if (!season) return 'Unknown Season'
  return `${season.name} (${formatDateString(season.start_date)} - ${formatDateString(season.end_date)})`
}
