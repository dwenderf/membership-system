'use client'

import { useState } from 'react'

interface GameCreationFormProps {
  registrationId: string
  onGameCreated: (game: any) => void
  onCancel: () => void
}

export default function GameCreationForm({ 
  registrationId, 
  onGameCreated, 
  onCancel 
}: GameCreationFormProps) {
  const [gameDescription, setGameDescription] = useState('')
  const [gameDate, setGameDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!gameDescription.trim()) {
      setError('Game description is required')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/alternate-registrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationId,
          gameDescription: gameDescription.trim(),
          gameDate: gameDate || null
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create game')
      }

      onGameCreated(data.game)
      
      // Reset form
      setGameDescription('')
      setGameDate('')
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Create New Game</h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <div>
          <label htmlFor="gameDescription" className="block text-sm font-medium text-gray-700 mb-1">
            Game Description *
          </label>
          <input
            type="text"
            id="gameDescription"
            value={gameDescription}
            onChange={(e) => setGameDescription(e.target.value)}
            placeholder="e.g., Game vs Team A, Practice Session, Tournament Game"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={loading}
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Describe the game or event that needs alternates
          </p>
        </div>

        <div>
          <label htmlFor="gameDate" className="block text-sm font-medium text-gray-700 mb-1">
            Game Date (Optional)
          </label>
          <input
            type="datetime-local"
            id="gameDate"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={loading}
          />
          <p className="text-xs text-gray-500 mt-1">
            When the game will take place (helps with organization)
          </p>
        </div>

        <div className="flex space-x-3 pt-4">
          <button
            type="submit"
            disabled={loading || !gameDescription.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Game'}
          </button>
          
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}