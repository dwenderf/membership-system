'use client'

import { useState } from 'react'

interface GameCreationFormProps {
  registrationId: string
  onGameCreated: (game: any) => void
  onCancel: () => void
}

// Helper function to convert datetime-local input to proper timestamp for storage
// This uses the same proven approach as the timing page
const formatForDB = (dateTimeLocal: string): string => {
  if (!dateTimeLocal) return ''
  // This works correctly: datetime-local is treated as local time,
  // then toISOString() converts to UTC with proper timezone handling
  return new Date(dateTimeLocal).toISOString()
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
  
  // Format date for display when form is complete
  const formatGameDateTime = (dateValue: string) => {
    if (!dateValue) return ''
    
    // Parse the datetime-local value and treat it as Eastern time
    const date = new Date(dateValue)
    
    // Format for display in Eastern Time with full details
    const formatted = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    }) + ' at ' + date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    
    // Add timezone indicator (EDT/EST based on date)
    const isDST = date.getMonth() >= 2 && date.getMonth() <= 10 // Rough DST check
    const tz = isDST ? 'EDT' : 'EST'
    
    return `${formatted} ${tz}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!gameDescription.trim()) {
      setError('Game description is required')
      return
    }
    
    if (!gameDate) {
      setError('Game date and time is required')
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
          // Convert datetime-local to proper timestamp for storage
          gameDate: gameDate ? formatForDB(gameDate) : null
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
            Game Date & Time *
          </label>
          <input
            type="datetime-local"
            id="gameDate"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={loading}
            required
          />
          {gameDate && gameDescription && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm font-medium text-blue-900">
                📅 {formatGameDateTime(gameDate)}
              </p>
              <p className="text-xs text-blue-700 mt-1">
                Time will be stored and displayed in Eastern Time
              </p>
            </div>
          )}
        </div>

        <div className="flex space-x-3 pt-4">
          <button
            type="submit"
            disabled={loading || !gameDescription.trim() || !gameDate}
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