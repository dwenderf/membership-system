'use client'

import { useMemo } from 'react'

interface Game {
  id: string
  registration_id: string
  game_description: string
  game_date: string | null
  created_at: string
  selected_count?: number
  available_count?: number
}

interface Registration {
  id: string
  name: string
  type: string
  allow_alternates: boolean
  alternate_price: number | null
  alternate_accounting_code: string | null
  is_active: boolean
  seasons: {
    id: string
    name: string
    end_date: string
  } | null
}

interface RegistrationWithGames extends Registration {
  games: Game[]
}

interface AllRegistrationsActivityGridProps {
  registrations: RegistrationWithGames[]
  onRegistrationWeekClick?: (registrationId: string, weekStart: string) => void
}

interface WeekData {
  weekStart: string
  weekEnd: string
  totalSelected: number
  games: Game[]
  weekNumber: number
}

interface RegistrationWeeklyData {
  registration: Registration
  weeks: WeekData[]
}

export default function AllRegistrationsActivityGrid({ 
  registrations, 
  onRegistrationWeekClick 
}: AllRegistrationsActivityGridProps) {
  const { seasonStart, seasonEnd, registrationData } = useMemo(() => {
    // Safety check
    if (!Array.isArray(registrations) || registrations.length === 0) {
      return {
        seasonStart: new Date(),
        seasonEnd: new Date(),
        registrationData: []
      }
    }

    // Find the overall season bounds from all registrations
    let earliestStart: Date | null = null
    let latestEnd: Date | null = null

    registrations.forEach(reg => {
      if (reg.seasons) {
        const seasonEnd = new Date(reg.seasons.end_date)
        const seasonStart = new Date(seasonEnd.getTime() - (6 * 30 * 24 * 60 * 60 * 1000)) // 6 months before end
        
        if (!earliestStart || seasonStart < earliestStart) {
          earliestStart = seasonStart
        }
        if (!latestEnd || seasonEnd > latestEnd) {
          latestEnd = seasonEnd
        }
      }
    })

    // Fallback to current date +/- 3 months if no season data
    const today = new Date()
    const fallbackStart = new Date(today.getTime() - (3 * 30 * 24 * 60 * 60 * 1000))
    const fallbackEnd = new Date(today.getTime() + (3 * 30 * 24 * 60 * 60 * 1000))
    
    const finalStart = earliestStart || fallbackStart
    const finalEnd = latestEnd || fallbackEnd

    // Process each registration's games into weekly data
    const regData: RegistrationWeeklyData[] = registrations.map(registration => {
      // Group games by week for this registration
      const weekMap = new Map<string, { games: Game[], totalSelected: number }>()

      registration.games.forEach(game => {
        if (!game.game_date) return
        
        const gameDate = new Date(game.game_date)
        
        // Get start of week (Sunday)
        const weekStart = new Date(gameDate)
        weekStart.setDate(gameDate.getDate() - gameDate.getDay())
        weekStart.setHours(0, 0, 0, 0)
        
        const weekKey = weekStart.toISOString().split('T')[0]
        
        if (!weekMap.has(weekKey)) {
          weekMap.set(weekKey, { games: [], totalSelected: 0 })
        }
        
        const weekData = weekMap.get(weekKey)!
        weekData.games.push(game)
        weekData.totalSelected += game.selected_count || 0
      })

      // Generate all weeks in the season for this registration
      const weeks: WeekData[] = []
      const current = new Date(finalStart)
      // Start from the beginning of the week containing season start
      current.setDate(current.getDate() - current.getDay())
      current.setHours(0, 0, 0, 0)
      
      let weekNumber = 1
      
      while (current <= finalEnd) {
        const weekStart = new Date(current)
        const weekEnd = new Date(current)
        weekEnd.setDate(weekEnd.getDate() + 6)
        
        const weekKey = weekStart.toISOString().split('T')[0]
        const weekData = weekMap.get(weekKey)
        
        weeks.push({
          weekStart: weekKey,
          weekEnd: weekEnd.toISOString().split('T')[0],
          totalSelected: weekData?.totalSelected || 0,
          games: weekData?.games || [],
          weekNumber
        })
        
        current.setDate(current.getDate() + 7)
        weekNumber++
      }

      return {
        registration,
        weeks
      }
    })

    return {
      seasonStart: finalStart,
      seasonEnd: finalEnd,
      registrationData: regData
    }
  }, [registrations])

  const getColorClass = (count: number) => {
    if (count === 0) return 'bg-gray-100'
    if (count <= 2) return 'bg-green-200'
    if (count <= 4) return 'bg-green-400'
    if (count <= 6) return 'bg-green-600'
    return 'bg-green-800'
  }

  const getTooltip = (registration: Registration, week: WeekData) => {
    const startDate = new Date(week.weekStart)
    const endDate = new Date(week.weekEnd)
    
    const formatDate = (date: Date) => date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })

    if (week.games.length === 0) {
      return `${registration.name}
Week ${week.weekNumber} (${formatDate(startDate)} - ${formatDate(endDate)})
No games scheduled`
    }

    const gamesCount = week.games.length
    const firstGame = week.games[0]?.game_description || 'Game'
    const moreText = gamesCount > 1 ? ` + ${gamesCount - 1} more` : ''

    return `${registration.name}
Week ${week.weekNumber} (${formatDate(startDate)} - ${formatDate(endDate)})
${week.totalSelected} alternates selected - ${firstGame}${moreText}`
  }

  const handleWeekClick = (registrationId: string, week: WeekData) => {
    if (week.games.length > 0 && onRegistrationWeekClick) {
      onRegistrationWeekClick(registrationId, week.weekStart)
    }
  }

  // Don't render if we have no valid data
  if (!Array.isArray(registrations) || registrations.length === 0 || registrationData.length === 0) {
    return null
  }

  // Get the total number of weeks from the first registration (they should all have the same)
  const totalWeeks = registrationData[0]?.weeks.length || 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-900">All Teams Activity Overview</h3>
        <div className="flex items-center space-x-2 text-xs text-gray-500">
          <span>Less</span>
          <div className="flex space-x-1">
            <div className="w-3 h-3 bg-gray-100 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-200 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-400 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-600 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-800 rounded-sm"></div>
          </div>
          <span>More</span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="space-y-2" style={{ minWidth: `${32 * 8 + totalWeeks * 16}px` }}>
          {registrationData.map(({ registration, weeks }) => (
            <div key={registration.id} className="flex items-center space-x-2">
              {/* Registration name - fixed width */}
              <div className="w-32 text-xs font-medium text-gray-700 truncate flex-shrink-0" title={registration.name}>
                {registration.name}
              </div>
              
              {/* Weekly grid for this registration */}
              <div className="flex gap-1 flex-shrink-0">
                {weeks.map(week => (
                  <div
                    key={week.weekStart}
                    className={`w-3 h-3 rounded-sm cursor-pointer hover:ring-2 hover:ring-gray-400 transition-all ${getColorClass(week.totalSelected)}`}
                    title={getTooltip(registration, week)}
                    onClick={() => handleWeekClick(registration.id, week)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        {registrationData.length} teams • {totalWeeks} weeks • {registrationData.reduce((total, reg) => total + reg.registration.games.length, 0)} total games
      </div>
    </div>
  )
}