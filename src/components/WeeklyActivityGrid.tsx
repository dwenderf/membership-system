'use client'

import { useMemo } from 'react'
import { formatDate } from '@/lib/date-utils'


interface Game {
  id: string
  registrationId: string
  gameDescription: string
  gameDate: string | null
  createdAt: string
  selectedCount?: number
  availableCount?: number
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

interface WeeklyActivityGridProps {
  games: Game[]
  registration: Registration
  onWeekClick?: (weekStart: string) => void
}

interface WeekData {
  weekStart: string
  weekEnd: string
  totalSelected: number
  games: Game[]
  weekNumber: number
}

export default function WeeklyActivityGrid({ games, registration, onWeekClick }: WeeklyActivityGridProps) {
  const weeklyData = useMemo(() => {
    // Safety check
    if (!registration || !Array.isArray(games)) {
      return []
    }

    // Get season dates or fallback to 6 months
    const today = new Date()
    const seasonStart = registration.seasons 
      ? new Date(new Date(registration.seasons.end_date).getTime() - (6 * 30 * 24 * 60 * 60 * 1000)) // 6 months before end
      : new Date(today.getTime() - (3 * 30 * 24 * 60 * 60 * 1000)) // 3 months ago
    
    const seasonEnd = registration.seasons 
      ? new Date(registration.seasons.end_date)
      : new Date(today.getTime() + (3 * 30 * 24 * 60 * 60 * 1000)) // 3 months from now

    // Group games by week
    const weekMap = new Map<string, { games: Game[], totalSelected: number }>()

    games.forEach(game => {
      if (!game.gameDate) return

      const gameDate = new Date(game.gameDate)

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
      weekData.totalSelected += game.selectedCount || 0
    })

    // Generate all weeks in the season
    const weeks: WeekData[] = []
    const current = new Date(seasonStart)
    // Start from the beginning of the week containing season start
    current.setDate(current.getDate() - current.getDay())
    current.setHours(0, 0, 0, 0)
    
    let weekNumber = 1
    
    while (current <= seasonEnd) {
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

    return weeks
  }, [games, registration])

  const getColorClass = (count: number) => {
    if (count === 0) return 'bg-gray-100'
    if (count <= 2) return 'bg-green-200'
    if (count <= 4) return 'bg-green-400'
    if (count <= 6) return 'bg-green-600'
    return 'bg-green-800'
  }

  const getTooltip = (week: WeekData) => {
    const startDate = new Date(week.weekStart)
    const endDate = new Date(week.weekEnd)

    if (week.games.length === 0) {
      return `Week ${week.weekNumber} (${formatDate(startDate)} - ${formatDate(endDate)}): No games`
    }

    const gamesList = week.games.map(game =>
      `${game.gameDescription} (${game.selectedCount || 0} selected)`
    ).join(', ')

    return `Week ${week.weekNumber} (${formatDate(startDate)} - ${formatDate(endDate)}): ${week.totalSelected} alternates selected\nGames: ${gamesList}`
  }

  const handleWeekClick = (week: WeekData) => {
    if (week.games.length > 0 && onWeekClick) {
      onWeekClick(week.weekStart)
    }
  }

  // Don't render if we have no valid data
  if (!registration || !Array.isArray(games) || weeklyData.length === 0) {
    return null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
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

      <div className="flex flex-wrap gap-1 mb-3">
        {weeklyData.map(week => (
          <div
            key={week.weekStart}
            className={`w-3 h-3 rounded-sm cursor-pointer hover:ring-2 hover:ring-gray-400 transition-all ${getColorClass(week.totalSelected)}`}
            title={getTooltip(week)}
            onClick={() => handleWeekClick(week)}
          />
        ))}
      </div>

      <div className="text-xs text-gray-500">
        {weeklyData.length} weeks • {games.length} games total
      </div>
    </div>
  )
}