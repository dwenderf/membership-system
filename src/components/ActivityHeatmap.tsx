'use client'

import { useMemo } from 'react'
import { formatDate } from '@/lib/date-utils'

// Note: CSS styles are handled inline below to avoid import conflicts

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

interface ActivityHeatmapProps {
  games: Game[]
  registration: Registration
  onDateClick?: (date: string) => void
}

interface HeatmapValue {
  date: string
  count: number
  games: Game[]
}

export default function ActivityHeatmap({ games, registration, onDateClick }: ActivityHeatmapProps) {
  const { startDate, endDate, heatmapData } = useMemo(() => {
    // Safety check - ensure we have valid data
    if (!registration || !Array.isArray(games)) {
      return {
        startDate: new Date(),
        endDate: new Date(),
        heatmapData: []
      }
    }
    // Get season dates or fallback to 6 months
    const today = new Date()
    const seasonStart = registration.seasons 
      ? new Date(new Date(registration.seasons.end_date).getTime() - (6 * 30 * 24 * 60 * 60 * 1000)) // 6 months before end
      : new Date(today.getTime() - (3 * 30 * 24 * 60 * 60 * 1000)) // 3 months ago
    
    const seasonEnd = registration.seasons 
      ? new Date(registration.seasons.end_date)
      : new Date(today.getTime() + (3 * 30 * 24 * 60 * 60 * 1000)) // 3 months from now

    // Process games into daily data
    const dailyData = new Map<string, { games: Game[], totalSelected: number }>()

    games.forEach(game => {
      if (!game.game_date) return
      
      const gameDate = new Date(game.game_date)
      const dateKey = gameDate.toISOString().split('T')[0] // YYYY-MM-DD
      
      if (!dailyData.has(dateKey)) {
        dailyData.set(dateKey, { games: [], totalSelected: 0 })
      }
      
      const dayData = dailyData.get(dateKey)!
      dayData.games.push(game)
      dayData.totalSelected += game.selected_count || 0
    })

    // Convert to heatmap format, filtering for Fri/Sat/Sun only
    const heatmapValues: HeatmapValue[] = []
    const current = new Date(seasonStart)
    
    while (current <= seasonEnd) {
      const dayOfWeek = current.getDay() // 0 = Sunday, 5 = Friday, 6 = Saturday
      
      // Only include Friday (5), Saturday (6), and Sunday (0)
      if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
        const dateKey = current.toISOString().split('T')[0]
        const dayData = dailyData.get(dateKey)
        
        heatmapValues.push({
          date: dateKey,
          count: dayData?.totalSelected || 0,
          games: dayData?.games || []
        })
      }
      
      current.setDate(current.getDate() + 1)
    }

    return {
      startDate: seasonStart,
      endDate: seasonEnd,
      heatmapData: heatmapValues
    }
  }, [games, registration])

  const getTooltipDataAttrs = (value: HeatmapValue | undefined) => {
    if (!value) {
      return {
        'data-tip': 'No date'
      }
    }

    if (!value.games || value.games.length === 0) {
      return {
        'data-tip': `${value.date}: No games scheduled`
      }
    }

    const date = new Date(value.date)
    const formattedDate = formatDate(date)

    const gamesSummary = value.games.map(game => 
      `${game.game_description || 'Untitled Game'} (${game.selected_count || 0} selected)`
    ).join(', ')

    return {
      'data-tip': `${formattedDate}: ${value.count} alternates selected\n${gamesSummary}`
    }
  }

  const handleClick = (value: HeatmapValue | undefined) => {
    if (value && value.games && value.games.length > 0 && onDateClick) {
      onDateClick(value.date)
    }
  }

  // Don't render if we have no valid data
  if (!heatmapData || heatmapData.length === 0) {
    return (
      <div className="text-gray-500 text-sm">
        No activity data available for this registration.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">
        Activity Heatmap for {registration.name}
      </div>
      <div className="grid grid-cols-12 gap-2">
        {heatmapData.map((value, index) => {
          const intensity = value.count > 0 ? Math.min(Math.ceil(value.count / 5), 4) : 0
          const bgColors = [
            'bg-gray-100',
            'bg-green-200',
            'bg-green-400',
            'bg-green-600',
            'bg-green-800'
          ]

          return (
            <div
              key={`${value.date}-${index}`}
              className={`h-8 rounded ${bgColors[intensity]} cursor-pointer hover:opacity-80 transition-opacity`}
              onClick={() => handleClick(value)}
              {...getTooltipDataAttrs(value)}
              title={getTooltipDataAttrs(value)['data-tip']}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{formatDate(startDate)}</span>
        <span>{formatDate(endDate)}</span>
      </div>
    </div>
  )
}