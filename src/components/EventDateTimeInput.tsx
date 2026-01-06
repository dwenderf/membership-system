'use client'

import { useState, useEffect } from 'react'
import DateTimePicker from '@/components/DateTimePicker'

interface EventDateTimeInputProps {
  startDate: string
  durationMinutes: string
  onStartDateChange: (value: string) => void
  onDurationChange: (value: string) => void
  registrationType?: 'event' | 'scrimmage' | 'game'
  required?: boolean
  disabled?: boolean
}

export default function EventDateTimeInput({
  startDate,
  durationMinutes,
  onStartDateChange,
  onDurationChange,
  registrationType = 'event',
  required = false,
  disabled = false,
}: EventDateTimeInputProps) {
  const [isPastDate, setIsPastDate] = useState(false)

  // Check if the selected date is in the past
  useEffect(() => {
    if (startDate) {
      const selectedDate = new Date(startDate)
      const now = new Date()
      setIsPastDate(selectedDate < now)
    } else {
      setIsPastDate(false)
    }
  }, [startDate])

  return (
    <div className="space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
      <div className="text-sm text-blue-800 mb-3">
        <strong>Date & Time:</strong> Enter times in Eastern Time (New York)
      </div>

      <div>
        <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-1">
          Start Date & Time {required && <span className="text-red-500">*</span>}
        </label>
        <DateTimePicker
          id="start_date"
          value={startDate}
          onChange={onStartDateChange}
          enableTime={true}
          minuteIncrement={5}
          required={required}
          disabled={disabled}
          placeholder="Select date and time..."
        />
        <p className="mt-1 text-xs text-gray-500">Time in 5-minute increments</p>

        {isPastDate && (
          <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded-md">
            <div className="flex items-start">
              <svg className="h-5 w-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-yellow-800">
                <strong>Warning:</strong> You've selected a date/time in the past.
              </p>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="duration_minutes" className="block text-sm font-medium text-gray-700">
          Duration {required && <span className="text-red-500">*</span>}
        </label>
        <div className="mt-1 flex items-center space-x-2">
          <input
            type="number"
            id="duration_minutes"
            value={durationMinutes}
            onChange={(e) => onDurationChange(e.target.value)}
            min="1"
            step="5"
            className="block w-32 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            required={required}
            disabled={disabled}
          />
          <span className="text-sm text-gray-700">minutes</span>
          {durationMinutes && (
            <span className="text-sm text-gray-500">
              ({Math.floor(parseInt(durationMinutes) / 60)}h {parseInt(durationMinutes) % 60}m)
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Default: {registrationType === 'scrimmage' || registrationType === 'game' ? '90 minutes (1.5 hours)' : '180 minutes (3 hours)'}
        </p>
      </div>
    </div>
  )
}
