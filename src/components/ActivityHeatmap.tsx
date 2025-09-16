'use client'

import { useMemo } from 'react'
import CalendarHeatmap from 'react-calendar-heatmap'
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

  const getTooltipDataAttrs = (value: HeatmapValue | null) => {
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
    const formattedDate = date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    })

    const gamesSummary = value.games.map(game => 
      `${game.game_description || 'Untitled Game'} (${game.selected_count || 0} selected)`
    ).join(', ')

    return {
      'data-tip': `${formattedDate}: ${value.count} alternates selected\n${gamesSummary}`
    }
  }

  const handleClick = (value: HeatmapValue | null) => {
    if (value && value.games && value.games.length > 0 && onDateClick) {
      onDateClick(value.date)
    }
  }

  // Don't render if we have no valid data
  if (!registration || !Array.isArray(games) || heatmapData.length === 0) {
    return null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2 text-xs text-gray-500">
          <span>Less</span>
          <div className="flex space-x-1">
            <div className="w-3 h-3 bg-gray-100 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-100 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-300 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-500 rounded-sm"></div>
            <div className="w-3 h-3 bg-green-700 rounded-sm"></div>
          </div>
          <span>More</span>
        </div>
      </div>

      <div className="activity-heatmap-container">
        <CalendarHeatmap
          startDate={startDate}
          endDate={endDate}
          values={heatmapData}
          classForValue={(value: HeatmapValue | null) => {
            if (!value || value.count === 0) return 'color-empty'
            if (value.count <= 2) return 'color-scale-1'
            if (value.count <= 4) return 'color-scale-2'
            if (value.count <= 6) return 'color-scale-3'
            return 'color-scale-4'
          }}
          tooltipDataAttrs={getTooltipDataAttrs}
          onClick={handleClick}
          showWeekdayLabels={true}
          showMonthLabels={true}
          horizontal={true}
          gutterSize={2}
          showOutOfRangeDays={false}
        />
      </div>

      <style jsx>{`
        .activity-heatmap-container {
          font-size: 12px;
          max-width: 800px;
          overflow-x: auto;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap) {
          width: 100%;
          height: auto;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap svg) {
          width: 100%;
          height: 120px;
          max-width: 800px;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap rect) {
          width: 10px;
          height: 10px;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap text) {
          fill: #767676;
          font-size: 10px;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .color-empty) {
          fill: #ebedf0;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .color-scale-1) {
          fill: #c6e48b;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .color-scale-2) {
          fill: #7bc96f;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .color-scale-3) {
          fill: #239a3b;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .color-scale-4) {
          fill: #196127;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap rect) {
          cursor: pointer;
          rx: 2;
          ry: 2;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap rect:hover) {
          stroke: #333;
          stroke-width: 1px;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .month-label) {
          font-size: 10px;
          fill: #767676;
        }
        
        .activity-heatmap-container :global(.react-calendar-heatmap .day-label) {
          font-size: 9px;
          fill: #767676;
        }
      `}</style>
    </div>
  )
}