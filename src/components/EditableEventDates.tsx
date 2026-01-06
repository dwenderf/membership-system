'use client'

import { useState } from 'react'
import { convertToNYTimezone, convertFromUTCToNYDateTimeLocal, formatDateTime } from '@/lib/date-utils'

interface EditableEventDatesProps {
  registrationId: string
  registrationType: 'team' | 'scrimmage' | 'event'
  initialStartDate: string | null
  initialEndDate: string | null
}

export default function EditableEventDates({
  registrationId,
  registrationType,
  initialStartDate,
  initialEndDate
}: EditableEventDatesProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [startDate, setStartDate] = useState(initialStartDate ? convertFromUTCToNYDateTimeLocal(initialStartDate) : '')
  const [endDate, setEndDate] = useState(initialEndDate ? convertFromUTCToNYDateTimeLocal(initialEndDate) : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Only show for events and scrimmages
  if (registrationType === 'team') {
    return null
  }

  const handleSave = async () => {
    if (!startDate || !endDate) {
      setError('Both start and end dates are required')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/admin/registrations/${registrationId}/dates`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start_date: convertToNYTimezone(startDate),
          end_date: convertToNYTimezone(endDate),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update dates')
      }

      setIsEditing(false)
      // Refresh the page to show updated dates
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setStartDate(initialStartDate ? convertFromUTCToNYDateTimeLocal(initialStartDate) : '')
    setEndDate(initialEndDate ? convertFromUTCToNYDateTimeLocal(initialEndDate) : '')
    setIsEditing(false)
    setError('')
  }

  if (isEditing) {
    return (
      <div className="space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
        <div className="text-sm text-blue-800 mb-3">
          <strong>Edit Event Dates:</strong> Enter times in Eastern Time (New York)
        </div>

        <div>
          <label htmlFor="edit_start_date" className="block text-sm font-medium text-gray-700">
            Start Date & Time
          </label>
          <input
            type="datetime-local"
            id="edit_start_date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="edit_end_date" className="block text-sm font-medium text-gray-700">
            End Date & Time
          </label>
          <input
            type="datetime-local"
            id="edit_end_date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex items-center space-x-2">
          <button
            onClick={handleSave}
            disabled={loading || !startDate || !endDate}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Dates'}
          </button>
          <button
            onClick={handleCancel}
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <dt className="text-sm font-medium text-gray-500 mb-1">Event Date & Time</dt>
      <dd className="text-sm text-gray-900 flex items-center space-x-2">
        {initialStartDate && initialEndDate ? (
          <div className="flex items-center space-x-2">
            <div>
              <div><strong>Start:</strong> {formatDateTime(initialStartDate)}</div>
              <div><strong>End:</strong> {formatDateTime(initialEndDate)}</div>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title="Edit event dates"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <span className="text-red-600">Not set (required for {registrationType}s)</span>
            <button
              onClick={() => setIsEditing(true)}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add Dates
            </button>
          </div>
        )}
      </dd>
    </div>
  )
}
