'use client'

import { useState, useEffect } from 'react'
import DateTimePicker from '@/components/DateTimePicker'
import DurationInput from '@/components/DurationInput'
import { convertToNYTimezone } from '@/lib/date-utils'

interface EventDateTimeInputProps {
  startDate: string
  durationMinutes: string
  onStartDateChange: (value: string) => void
  onDurationChange: (value: string) => void
  registrationType?: 'event' | 'scrimmage' | 'game' | 'tournament'
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
  const isTournament = registrationType === 'tournament'

  // Check if the selected date is in the past
  useEffect(() => {
    if (startDate) {
      // Convert datetime-local to NY timezone before comparing
      const selectedDateISO = convertToNYTimezone(startDate)
      const selectedDate = new Date(selectedDateISO)
      const now = new Date()
      setIsPastDate(selectedDate < now)
    } else {
      setIsPastDate(false)
    }
  }, [startDate])

  // For tournaments, convert between days and minutes
  // 1 day = 1440 minutes (24 hours)
  const durationDays = isTournament && durationMinutes
    ? String(Math.round(parseInt(durationMinutes) / 1440))
    : ''

  const handleDurationDaysChange = (days: string) => {
    // Convert days to minutes (1 day = 1440 minutes)
    const minutes = days ? String(parseInt(days) * 1440) : ''
    onDurationChange(minutes)
  }

  return (
    <div className="space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-md dark:bg-blue-900/20 dark:border-blue-800">
      <div className="text-sm text-blue-800 mb-3 dark:text-blue-300">
        <strong>{isTournament ? 'Tournament Dates:' : 'Date & Time:'}</strong>{' '}
        {isTournament
          ? 'Tournaments are all-day events (no specific times)'
          : 'Enter times in Eastern Time (New York)'}
      </div>

      <div>
        <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
          {isTournament ? 'Start Date' : 'Start Date & Time'} {required && <span className="text-red-500">*</span>}
        </label>
        <DateTimePicker
          id="start_date"
          value={startDate}
          onChange={onStartDateChange}
          enableTime={!isTournament}
          minuteIncrement={5}
          required={required}
          disabled={disabled}
          placeholder={isTournament ? "Select start date..." : "Select date and time..."}
        />

        {isPastDate && (
          <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded-md dark:bg-yellow-900/20 dark:border-yellow-800">
            <div className="flex items-start">
              <svg className="h-5 w-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                <strong>Warning:</strong> You've selected a date{isTournament ? '' : '/time'} in the past.
              </p>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="duration_input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Duration {required && <span className="text-red-500">*</span>}
        </label>
        <div className="mt-1">
          {isTournament ? (
            // For tournaments, show a simple number input for days
            <div className="relative">
              <input
                type="number"
                id="duration_input"
                value={durationDays}
                onChange={(e) => handleDurationDaysChange(e.target.value)}
                min="1"
                step="1"
                required={required}
                disabled={disabled}
                className="block w-full pl-3 pr-16 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="1"
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm dark:text-gray-400">
                  {durationDays === '1' ? 'day' : 'days'}
                </span>
              </div>
            </div>
          ) : (
            <DurationInput
              id="duration_input"
              value={durationMinutes}
              onChange={onDurationChange}
              required={required}
              disabled={disabled}
              minMinutes={1}
              roundToNearest={1}
            />
          )}
        </div>
        {isTournament && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Number of days the tournament runs (e.g., 3 for a 3-day tournament)
          </p>
        )}
      </div>
    </div>
  )
}
