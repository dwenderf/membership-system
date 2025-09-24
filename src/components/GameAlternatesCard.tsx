'use client'

import { useState, useEffect } from 'react'
import { AlternatesAccessResult } from '@/lib/utils/alternates-access'
import { useToast } from '@/contexts/ToastContext'

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
  alternate_price: number | null
  alternate_accounting_code: string | null
}

interface Alternate {
  id: string
  user_id: string
  firstName: string
  lastName: string
  email: string
  registeredAt: string
  hasValidPaymentMethod: boolean
  isAlreadySelected: boolean
  discountCode?: {
    id: string
    code: string
    percentage: number
    discountAmount: number
    categoryName?: string
    isOverLimit: boolean
  } | null
  pricing: {
    basePrice: number
    discountAmount: number
    finalAmount: number
  }
}

interface GameAlternatesCardProps {
  game: Game
  registration: Registration
  dateTag: { text: string; isUrgent: boolean } | null
  userAccess: AlternatesAccessResult
  onCountsUpdated?: (gameId: string, selectedCount: number, availableCount: number) => void
}

export default function GameAlternatesCard({ 
  game, 
  registration, 
  dateTag, 
  userAccess,
  onCountsUpdated
}: GameAlternatesCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [alternates, setAlternates] = useState<Alternate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectedAlternates, setSelectedAlternates] = useState<Set<string>>(new Set())
  const { showSuccess, showError } = useToast()

  // Fetch alternates when expanded
  useEffect(() => {
    if (isExpanded && alternates.length === 0) {
      fetchAlternates()
    }
  }, [isExpanded])

  const fetchAlternates = async () => {
    try {
      setLoading(true)
      setError('')
      
      const response = await fetch(`/api/alternate-registrations/${game.id}/alternates`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch alternates')
      }

      const data = await response.json()
      setAlternates(data.alternates || [])
    } catch (err) {
      console.error('Error fetching alternates:', err)
      setError(err instanceof Error ? err.message : 'Failed to load alternates')
    } finally {
      setLoading(false)
    }
  }

  const handleAlternateToggle = (alternateId: string) => {
    setSelectedAlternates(prev => {
      const newSet = new Set(prev)
      if (newSet.has(alternateId)) {
        newSet.delete(alternateId)
      } else {
        newSet.add(alternateId)
      }
      return newSet
    })
  }

  const handleSelectAlternates = async () => {
    if (selectedAlternates.size === 0) return

    try {
      setSelecting(true)
      
      const response = await fetch(`/api/alternate-registrations/${game.id}/select`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          alternateIds: Array.from(selectedAlternates)
        })
      })

      if (!response.ok) {
        throw new Error('Failed to select alternates')
      }

      const data = await response.json()
      
      // Refresh alternates list to show updated selection status
      await fetchAlternates()
      setSelectedAlternates(new Set())
      setError('') // Clear any previous errors
      
      // Handle results and show appropriate toasts
      if (data.results) {
        const successful = data.results.filter((r: any) => r.success).length
        const failed = data.results.filter((r: any) => !r.success).length
        
        if (failed > 0) {
          showError(
            'Some Alternates Failed', 
            `${successful} alternates charged successfully, ${failed} failed`
          )
        } else if (successful > 0) {
          showSuccess(
            'Alternates Selected',
            `${successful} alternate${successful !== 1 ? 's' : ''} charged successfully`
          )
        }
        
        // Update counts in parent component
        if (onCountsUpdated) {
          // Calculate new counts after refresh
          const newSelectedCount = (game.selected_count || 0) + successful
          const newAvailableCount = Math.max(0, (game.available_count || 0) - successful)
          onCountsUpdated(game.id, newSelectedCount, newAvailableCount)
        }
      }
      
    } catch (err) {
      console.error('Error selecting alternates:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to select alternates'
      setError(errorMessage)
      showError('Selection Failed', errorMessage)
    } finally {
      setSelecting(false)
    }
  }

  // Use pre-calculated counts from API when available, otherwise calculate from loaded alternates
  const availableAlternates = alternates.filter(alt => !alt.isAlreadySelected)
  const selectedCount = game.selected_count ?? alternates.filter(alt => alt.isAlreadySelected).length
  const availableCount = game.available_count ?? availableAlternates.length

  const formatGameDateTime = (dateStr: string | null) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric'
    }) + ' at ' + date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="border border-gray-200 rounded-lg">
      {/* Card Header - Clickable to expand/collapse */}
      <div 
        className="p-4 cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h4 className="text-lg font-medium text-gray-900">
                {game.game_description || 'Untitled Game'}
              </h4>
              {dateTag && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  dateTag.isUrgent ? 'bg-green-100 text-green-800' :
                  dateTag.text.includes('ago') ? 'bg-gray-100 text-gray-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {dateTag.text}
                </span>
              )}
            </div>
            {game.game_date ? (
              <p className="text-sm text-gray-600 mt-1">
                {formatGameDateTime(game.game_date)}
              </p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">No date specified</p>
            )}
            <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
              <span>{availableCount} available</span>
              <span className={selectedCount > 0 ? 'text-green-600 font-medium' : ''}>
                {selectedCount} selected
              </span>
            </div>
          </div>
          <div className="flex items-center">
            <svg 
              className={`h-5 w-5 text-gray-400 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-4">
          {loading ? (
            <div className="text-center py-4">
              <div className="text-gray-500">Loading alternates...</div>
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <div className="text-red-600 text-sm mb-2">{error}</div>
              <button
                onClick={fetchAlternates}
                className="text-blue-600 hover:text-blue-500 text-sm font-medium"
              >
                Try Again
              </button>
            </div>
          ) : alternates.length === 0 ? (
            <div className="text-center py-4">
              <div className="text-gray-500">No alternates registered for this registration</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selection Actions */}
              {selectedAlternates.size > 0 && (
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <span className="text-sm font-medium text-blue-900">
                    {selectedAlternates.size} alternate{selectedAlternates.size !== 1 ? 's' : ''} selected
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setSelectedAlternates(new Set())}
                      className="text-xs text-blue-600 hover:text-blue-500"
                    >
                      Clear
                    </button>
                    <button
                      onClick={handleSelectAlternates}
                      disabled={selecting}
                      className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    >
                      {selecting ? 'Selecting...' : 'Select & Charge'}
                    </button>
                  </div>
                </div>
              )}

              {/* Alternates List */}
              <div className="space-y-2">
                {alternates
                  .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
                  .map(alternate => (
                    <div key={alternate.id} className={`flex items-center justify-between p-3 border rounded-md ${
                      alternate.isAlreadySelected 
                        ? 'bg-green-50 border-green-200' 
                        : 'border-gray-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={alternate.isAlreadySelected || selectedAlternates.has(alternate.id)}
                          onChange={() => handleAlternateToggle(alternate.id)}
                          disabled={alternate.isAlreadySelected || selecting}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                        />
                        <div>
                          <div className="font-medium text-gray-900">
                            {alternate.firstName} {alternate.lastName}
                          </div>
                          <div className="text-sm text-gray-500">{alternate.email}</div>
                          {alternate.discountCode && (
                            <div className="text-xs text-purple-600">
                              {alternate.discountCode.code} (-{alternate.discountCode.percentage}%)
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-gray-900">
                          ${(alternate.pricing.finalAmount / 100).toFixed(2)}
                        </div>
                        {alternate.pricing.discountAmount > 0 && (
                          <div className="text-xs text-gray-500 line-through">
                            ${(alternate.pricing.basePrice / 100).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}