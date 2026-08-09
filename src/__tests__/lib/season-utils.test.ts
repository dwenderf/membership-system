import { classifySeasons, getDefaultSeasonId, SeasonSummary } from '@/lib/utils/season-utils'

const referenceDate = new Date('2026-08-09T12:00:00Z')

const pastSeason: SeasonSummary = {
  id: 'past-1',
  name: 'Winter 2025',
  startDate: '2025-01-01',
  endDate: '2025-03-31'
}

const olderPastSeason: SeasonSummary = {
  id: 'past-2',
  name: 'Fall 2024',
  startDate: '2024-09-01',
  endDate: '2024-12-31'
}

const currentSeason: SeasonSummary = {
  id: 'current-1',
  name: 'Summer 2026',
  startDate: '2026-06-01',
  endDate: '2026-08-31'
}

const nextSeason: SeasonSummary = {
  id: 'next-1',
  name: 'Fall 2026',
  startDate: '2026-09-01',
  endDate: '2026-12-31'
}

const laterFutureSeason: SeasonSummary = {
  id: 'future-2',
  name: 'Spring 2027',
  startDate: '2027-03-01',
  endDate: '2027-05-31'
}

describe('classifySeasons', () => {
  it('identifies the current, next, and other seasons', () => {
    const result = classifySeasons(
      [pastSeason, olderPastSeason, currentSeason, nextSeason, laterFutureSeason],
      referenceDate
    )

    expect(result.current?.id).toBe('current-1')
    expect(result.next?.id).toBe('next-1')
    // "other" should contain everything else, most recent first
    expect(result.other.map(s => s.id)).toEqual(['future-2', 'past-1', 'past-2'])
  })

  it('returns null current when no season covers today', () => {
    const result = classifySeasons([pastSeason, nextSeason], referenceDate)

    expect(result.current).toBeNull()
    expect(result.next?.id).toBe('next-1')
    expect(result.other.map(s => s.id)).toEqual(['past-1'])
  })

  it('returns null next when there is no upcoming season', () => {
    const result = classifySeasons([pastSeason, olderPastSeason, currentSeason], referenceDate)

    expect(result.current?.id).toBe('current-1')
    expect(result.next).toBeNull()
    expect(result.other.map(s => s.id)).toEqual(['past-1', 'past-2'])
  })

  it('handles a single season that is the current one', () => {
    const result = classifySeasons([currentSeason], referenceDate)

    expect(result.current?.id).toBe('current-1')
    expect(result.next).toBeNull()
    expect(result.other).toEqual([])
  })

  it('handles an empty season list', () => {
    const result = classifySeasons([], referenceDate)

    expect(result).toEqual({ current: null, next: null, other: [] })
  })

  it('treats the reference date boundaries as inclusive', () => {
    const seasonStartingToday: SeasonSummary = {
      id: 'boundary-start',
      name: 'Starts Today',
      startDate: '2026-08-09',
      endDate: '2026-09-09'
    }
    const seasonEndingToday: SeasonSummary = {
      id: 'boundary-end',
      name: 'Ends Today',
      startDate: '2026-07-01',
      endDate: '2026-08-09'
    }

    expect(classifySeasons([seasonStartingToday], referenceDate).current?.id).toBe('boundary-start')
    expect(classifySeasons([seasonEndingToday], referenceDate).current?.id).toBe('boundary-end')
  })
})

describe('getDefaultSeasonId', () => {
  it('prefers the current season', () => {
    const id = getDefaultSeasonId([pastSeason, currentSeason, nextSeason], referenceDate)
    expect(id).toBe('current-1')
  })

  it('falls back to the next season when there is no current season', () => {
    const id = getDefaultSeasonId([pastSeason, nextSeason], referenceDate)
    expect(id).toBe('next-1')
  })

  it('falls back to the most recent past season when there is no current or next season', () => {
    const id = getDefaultSeasonId([olderPastSeason, pastSeason], referenceDate)
    expect(id).toBe('past-1')
  })

  it('returns null when there are no seasons at all', () => {
    expect(getDefaultSeasonId([], referenceDate)).toBeNull()
  })
})
