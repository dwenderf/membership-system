'use client'

import { useState, useEffect } from 'react'
import { formatDate as formatDateUtil } from '@/lib/date-utils'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import GameCreationForm from '@/components/GameCreationForm'

interface Game {
  id: string
  registrationId: string
  gameDescription: string
  gameDate: string | null
  createdAt: string
  selectedCount?: number
  availableCount?: number
}

interface GamesPreviewProps {
  registrationId: string
}

export default function GamesPreview({ registrationId }: GamesPreviewProps) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchGames()
  }, [registrationId])

  const fetchGames = async () => {
    try {
      const response = await fetch(`/api/alternate-registrations?registrationId=${registrationId}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch games')
      }

      const gamesData = await response.json()
      setGames(gamesData.games)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load games')
    } finally {
      setLoading(false)
    }
  }

  const handleGameCreated = (newGame: any) => {
    setGames(prev => [newGame, ...prev])
    setShowCreateForm(false)
  }

  const formatDate = (dateString: string) => {
    return formatDateUtil(new Date(dateString))
  }

  const isPastGame = (gameDate: string | null) => {
    if (!gameDate) return false
    return new Date(gameDate) <= new Date()
  }

  // Separate future and past games
  const futureGames = games.filter(game => !isPastGame(game.gameDate))
  const pastGames = games.filter(game => isPastGame(game.gameDate))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-500">Loading games...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Game Creation Form */}
      {showCreateForm && (
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <GameCreationForm
            registrationId={registrationId}
            onGameCreated={handleGameCreated}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* Future Games */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-md font-medium text-gray-900">
            Upcoming Games ({futureGames.length})
          </h3>
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
            >
              Add Game
            </button>
          )}
        </div>

        {futureGames.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <p>No upcoming games scheduled.</p>
            {!showCreateForm && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-2 text-blue-600 hover:text-blue-800 text-sm"
              >
                Create your first game
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {futureGames.slice(0, 3).map((game) => (
              <div
                key={game.id}
                className="border border-gray-200 rounded-lg p-3 bg-white"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">
                      {game.gameDescription}
                    </h4>
                    <div className="mt-1 text-xs text-gray-500">
                      {game.gameDate ? formatDate(game.gameDate) : 'No date'} • {game.selectedCount || 0} alternates selected
                    </div>
                  </div>
                  <Link
                    href={`/admin/registrations/${registrationId}/games`}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Manage →
                  </Link>
                </div>
              </div>
            ))}
            {futureGames.length > 3 && (
              <div className="text-center pt-2">
                <Link
                  href={`/admin/registrations/${registrationId}/games`}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  View all {futureGames.length} upcoming games →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Past Games */}
      {pastGames.length > 0 && (
        <div>
          <h3 className="text-md font-medium text-gray-900 mb-4">
            Past Games ({pastGames.length})
          </h3>
          <div className="space-y-3">
            {pastGames.slice(0, 2).map((game) => (
              <div
                key={game.id}
                className="border border-gray-200 rounded-lg p-3 bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">
                      {game.gameDescription}
                    </h4>
                    <div className="mt-1 text-xs text-gray-500">
                      {game.gameDate ? formatDate(game.gameDate) : 'No date'} • {game.selectedCount || 0} alternates selected
                    </div>
                  </div>
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    Completed
                  </span>
                </div>
              </div>
            ))}
            {pastGames.length > 2 && (
              <div className="text-center pt-2">
                <Link
                  href={`/admin/registrations/${registrationId}/games`}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  View all {pastGames.length} past games →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}