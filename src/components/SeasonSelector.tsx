'use client'

import { classifySeasons, SeasonSummary } from '@/lib/utils/season-utils'

interface SeasonSelectorProps {
  seasons: SeasonSummary[]
  selectedSeasonId: string
  onSelect: (seasonId: string) => void
  // Adds a leading "All Seasons" pill. Only used by filter pages that
  // support viewing everything at once (e.g. registration reports).
  allowAllOption?: boolean
}

const ALL_SEASONS_VALUE = 'all'

const pillBaseClasses = 'px-4 py-2 rounded-md text-sm font-medium transition-colors'
const pillActiveClasses = 'bg-blue-600 text-white'
const pillInactiveClasses = 'text-gray-600 hover:bg-white hover:text-gray-800'

export default function SeasonSelector({ seasons, selectedSeasonId, onSelect, allowAllOption }: SeasonSelectorProps) {
  const { current, next, other } = classifySeasons(seasons)
  const isOtherSelected = other.some(season => season.id === selectedSeasonId)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center space-x-1 bg-gray-100 rounded-md p-1">
        {allowAllOption && (
          <button
            type="button"
            onClick={() => onSelect(ALL_SEASONS_VALUE)}
            className={`${pillBaseClasses} ${selectedSeasonId === ALL_SEASONS_VALUE ? pillActiveClasses : pillInactiveClasses}`}
          >
            All Seasons
          </button>
        )}
        {current && (
          <button
            type="button"
            onClick={() => onSelect(current.id)}
            className={`${pillBaseClasses} ${selectedSeasonId === current.id ? pillActiveClasses : pillInactiveClasses}`}
          >
            Current Season ({current.name})
          </button>
        )}
        {next && (
          <button
            type="button"
            onClick={() => onSelect(next.id)}
            className={`${pillBaseClasses} ${selectedSeasonId === next.id ? pillActiveClasses : pillInactiveClasses}`}
          >
            Next Season ({next.name})
          </button>
        )}
      </div>

      {other.length > 0 && (
        <select
          value={isOtherSelected ? selectedSeasonId : ''}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value)
          }}
          className={`block px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
            isOtherSelected ? 'border-blue-500 text-gray-900 font-medium' : 'border-gray-300 text-gray-600'
          }`}
        >
          <option value="" disabled>Past Seasons...</option>
          {other.map(season => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}
