'use client'

import { useState } from 'react'
import { convertToNYTimezone } from '@/lib/date-utils'
import { useToast } from '@/contexts/ToastContext'
import EventDateTimeInput from '@/components/EventDateTimeInput'

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
  const [durationMinutes, setDurationMinutes] = useState('90') // Default to 90 minutes for games
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDescriptionWarning, setShowDescriptionWarning] = useState(false)
  const { showSuccess, showError } = useToast()

  const handleDateChange = (newDate: string) => {
    setGameDate(newDate)
    // Show warning if setting a date but description is empty
    if (newDate && !gameDescription.trim()) {
      setShowDescriptionWarning(true)
    }
  }

  const handleDescriptionChange = (newDescription: string) => {
    setGameDescription(newDescription)
    // Hide warning once description is entered
    if (newDescription.trim()) {
      setShowDescriptionWarning(false)
    }
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

    if (!durationMinutes) {
      setError('Duration is required')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Convert datetime-local to America/New_York timezone for storage
      const gameDateUTC = convertToNYTimezone(gameDate)

      // Calculate end time from start + duration
      const startDate = new Date(gameDateUTC)
      const endDate = new Date(startDate.getTime() + parseInt(durationMinutes) * 60 * 1000)
      const gameEndTimeUTC = endDate.toISOString()

      const response = await fetch('/api/alternate-registrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationId,
          gameDescription: gameDescription.trim(),
          gameDate: gameDateUTC,
          gameEndTime: gameEndTimeUTC
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create game')
      }

      // Show success toast
      showSuccess('Game Created', `"${gameDescription.trim()}" has been created successfully`)

      // Update parent component with new game data
      onGameCreated(data.game)

      // Reset form
      setGameDescription('')
      setGameDate('')
      setDurationMinutes('90') // Reset to default
      setError('') // Clear any previous errors
      setShowDescriptionWarning(false) // Clear warning

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create game'
      setError(errorMessage)
      showError('Failed to Create Game', errorMessage)
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
            onChange={(e) => handleDescriptionChange(e.target.value)}
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
          <EventDateTimeInput
            startDate={gameDate}
            durationMinutes={durationMinutes}
            onStartDateChange={handleDateChange}
            onDurationChange={setDurationMinutes}
            registrationType="game"
            required={true}
            disabled={loading}
          />
          {showDescriptionWarning && (
            <div className="mt-2 p-3 bg-orange-50 border border-orange-300 rounded-md">
              <p className="text-orange-800 text-sm font-medium">
                ⚠️ Don't forget to enter a game description above!
              </p>
            </div>
          )}
        </div>

        <div className="flex space-x-3 pt-4">
          <button
            type="submit"
            disabled={loading || !gameDescription.trim() || !gameDate || !durationMinutes}
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