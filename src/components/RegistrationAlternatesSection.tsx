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
    setGames(prev => [...prev, game])
    setShowCreateForm(false)
  }

  const getGameDateTag = (gameDate: string | null) => {
    if (!gameDate) return null
    
    const game = new Date(gameDate)
    const today = new Date()
    const diffTime = game.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Tomorrow'
    if (diffDays > 0) return `in ${diffDays} days`
    if (diffDays === -1) return 'Yesterday'
    return `${Math.abs(diffDays)} days ago`
  }

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Section Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-medium text-gray-900">{registration.name}</h3>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
                registration.type === 'scrimmage' ? 'bg-green-100 text-green-800' :
                'bg-purple-100 text-purple-800'
              }`}>
                {registration.type}
              </span>
              {registration.seasons && (
                <span className="text-xs text-gray-500">
                  {registration.seasons.name}
                </span>
              )}
              {registration.alternate_price && (
                <span className="text-xs text-gray-500">
                  ${(registration.alternate_price / 100).toFixed(2)} per alternate
                </span>
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}