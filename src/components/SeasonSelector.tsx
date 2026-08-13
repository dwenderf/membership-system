'use client'

import { classifySeasons, SeasonSummary } from '@/lib/utils/season-utils'

interface SeasonSelectorProps {
  seasons: SeasonSummary[]
  selectedSeasonId: string
  onSelect: (seasonId: string) => void
}

export const pillGroupClasses = 'flex items-center space-x-1 bg-gray-100 rounded-md p-1'
export const pillBaseClasses = 'px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors'
export const pillActiveClasses = 'bg-blue-600 text-white'
export const pillInactiveClasses = 'text-gray-600 hover:bg-white hover:text-gray-800'

export default function SeasonSelector({ seasons, selectedSeasonId, onSelect }: SeasonSelectorProps) {
  const { current, next, other } = classifySeasons(seasons)
  const isOtherSelected = other.some(season => season.id === selectedSeasonId)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={pillGroupClasses}>
        {current && (
          <button
            type="button"
            onClick={() => onSelect(current.id)}
            title={current.name}
            className={`${pillBaseClasses} ${selectedSeasonId === current.id ? pillActiveClasses : pillInactiveClasses}`}
          >
            Current
          </button>
        )}
        {next && (
          <button
            type="button"
            onClick={() => onSelect(next.id)}
            title={next.name}
            className={`${pillBaseClasses} ${selectedSeasonId === next.id ? pillActiveClasses : pillInactiveClasses}`}
          >
            Next
          </button>
        )}
      </div>

      {other.length > 0 && (
        <select
          value={isOtherSelected ? selectedSeasonId : ''}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value)
          }}
          aria-label="Past season"
          className={`block px-3 py-1.5 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm ${
            isOtherSelected ? 'border-blue-500 text-gray-900 font-medium' : 'border-gray-300 text-gray-600'
          }`}
        >
          <option value="" disabled>Past</option>
          {other.map(season => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}
