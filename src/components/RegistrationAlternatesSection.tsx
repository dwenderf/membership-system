'use client'

import { useState, useEffect } from 'react'
import { AlternatesAccessResult } from '@/lib/utils/alternates-access'
import GameAlternatesCard from '@/components/GameAlternatesCard'
import GameCreationForm from '@/components/GameCreationForm'

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

interface Game {
  id: string
  registration_id: string
  game_description: string
  game_date: string | null
  created_at: string
  selected_count?: number
  available_count?: number
}

interface RegistrationAlternatesSectionProps {
  registration: Registration
  userAccess: AlternatesAccessResult
}

export default function RegistrationAlternatesSection({ 
  registration, 
  userAccess 
}: RegistrationAlternatesSectionProps) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Fetch games for this registration
  useEffect(() => {
    fetchGames()
  }, [registration.id])

  const fetchGames = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/alternate-registrations?registrationId=${registration.id}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch games')
      }

      const data = await response.json()
      setGames(data.games || [])
    } catch (err) {
      console.error('Error fetching games:', err)
      setError(err instanceof Error ? err.message : 'Failed to load games')
    } finally {
      setLoading(false)
    }
  }

  const handleGameCreated = (game: Game) => {
    // Add the new game to the list and sort by game_date (descending, like the API)
    setGames(prev => {
      const newGames = [...prev, game]
      return newGames.sort((a, b) => {
        // Handle null dates - put them at the end
        if (!a.game_date && !b.game_date) return 0
        if (!a.game_date) return 1
        if (!b.game_date) return -1
        
        // Sort by date descending (newest first)
        return new Date(b.game_date).getTime() - new Date(a.game_date).getTime()
      })
    })
    setShowCreateForm(false)
  }

  const handleCountsUpdated = (gameId: string, selectedCount: number, availableCount: number) => {
    setGames(prev => prev.map(game => 
      game.id === gameId 
        ? { ...game, selected_count: selectedCount, available_count: availableCount }
        : game
    ))
  }

  const getGameDateTag = (gameDate: string | null) => {
    if (!gameDate) return null
    
    const game = new Date(gameDate)
    const today = new Date()
    const diffTime = game.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return { text: 'Today', isUrgent: true }
    if (diffDays === 1) return { text: 'Tomorrow', isUrgent: true }
    if (diffDays > 0 && diffDays < 4) return { text: `in ${diffDays} days`, isUrgent: true }
    if (diffDays > 0) return { text: `in ${diffDays} days`, isUrgent: false }
    if (diffDays === -1) return { text: 'Yesterday', isUrgent: false }
    return { text: `${Math.abs(diffDays)} days ago`, isUrgent: false }
  }

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Section Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-medium text-gray-900">{registration.name}</h3>
            <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
              {registration.seasons && (
                <span>{registration.seasons.name}</span>
              )}
              {registration.alternate_price && (
                <span>${(registration.alternate_price / 100).toFixed(2)} per alternate</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {showCreateForm ? 'Cancel' : 'Add Game'}
          </button>
        </div>
      </div>

      {/* Create Game Form */}
      {showCreateForm && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <GameCreationForm
            registrationId={registration.id}
            onGameCreated={handleGameCreated}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* Games List */}
      <div className="p-6">
        {loading ? (
          <div className="text-center py-8">
            <div className="text-gray-500">Loading games...</div>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <div className="text-red-600 text-sm">{error}</div>
            <button
              onClick={fetchGames}
              className="mt-2 text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              Try Again
            </button>
          </div>
        ) : games.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-500 text-lg mb-2">No games created yet</div>
            <p className="text-sm text-gray-600">
              Create a game to start managing alternates for this registration.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {games.map(game => (
              <GameAlternatesCard
                key={game.id}
                game={game}
                registration={registration}
                dateTag={getGameDateTag(game.game_date)}
                userAccess={userAccess}
                onCountsUpdated={handleCountsUpdated}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}