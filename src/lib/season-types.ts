export interface SeasonType {
  key: 'fall_winter' | 'spring_summer'
  name: string
  description: string
  startMonth: number // 1-12
  startDay: number
  durationMonths: number
}

export const SEASON_TYPES: SeasonType[] = [
  {
    key: 'fall_winter',
    name: 'Fall/Winter',
    description: 'September through February',
    startMonth: 9, // September
    startDay: 1,
    durationMonths: 6
  },
  {
    key: 'spring_summer', 
    name: 'Spring/Summer',
    description: 'March through August',
    startMonth: 3, // March
    startDay: 1,
    durationMonths: 6
  }
]

export function calculateSeasonDates(seasonType: SeasonType, startYear: number) {
  // For Fall/Winter: starts Sept 1, YYYY and ends Feb 28/29, YYYY+1
  // For Spring/Summer: starts March 1, YYYY and ends Aug 31, YYYY
  
  const actualStartYear = seasonType.key === 'fall_winter' ? startYear : startYear
  const endYear = seasonType.key === 'fall_winter' ? startYear + 1 : startYear
  
  const startDate = new Date(actualStartYear, seasonType.startMonth - 1, seasonType.startDay)
  
  // Calculate end date
  let endDate: Date
  if (seasonType.key === 'fall_winter') {
    // End on last day of February
    endDate = new Date(endYear, 2, 0) // Feb has index 1, so 2-1=1, and day 0 = last day of previous month
  } else {
    // End on Aug 31
    endDate = new Date(endYear, 7, 31) // August has index 7
  }
  
  return {
    startDate,
    endDate
  }
}

export function generateSeasonName(seasonType: SeasonType, startYear: number): string {
  return `${seasonType.name} ${startYear}`
}

export function getSeasonTypeByKey(key: string): SeasonType | undefined {
  return SEASON_TYPES.find(type => type.key === key)
}