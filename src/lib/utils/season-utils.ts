import { toDateString } from '@/lib/date-utils'

export interface SeasonSummary {
  id: string
  name: string
  startDate: string
  endDate: string
}

export interface ClassifiedSeasons {
  current: SeasonSummary | null
  next: SeasonSummary | null
  // Everything that isn't "current" or "next" - mostly past seasons, sorted
  // most-recent-first, but may also include a rare extra future season.
  other: SeasonSummary[]
}

/**
 * Classify a list of seasons relative to a reference date (defaults to now)
 * into "current", "next", and everything else.
 */
export function classifySeasons(seasons: SeasonSummary[], referenceDate: Date = new Date()): ClassifiedSeasons {
  const today = toDateString(referenceDate)

  const current = seasons.find(season => season.startDate <= today && season.endDate >= today) || null

  const futureSeasons = seasons
    .filter(season => season.startDate > today && season.id !== current?.id)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const next = futureSeasons[0] || null

  const other = seasons
    .filter(season => season.id !== current?.id && season.id !== next?.id)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))

  return { current, next, other }
}

/**
 * Pick the season that should be selected by default: the current season if
 * one exists, otherwise the next upcoming season, otherwise the most recent
 * past season.
 */
export function getDefaultSeasonId(seasons: SeasonSummary[], referenceDate: Date = new Date()): string | null {
  const { current, next, other } = classifySeasons(seasons, referenceDate)
  return current?.id ?? next?.id ?? other[0]?.id ?? null
}
