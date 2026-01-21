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
      // Convert datetime-local to NY timezone before comparing
      const selectedDateISO = convertToNYTimezone(startDate)
      const selectedDate = new Date(selectedDateISO)
      const now = new Date()
      setIsPastDate(selectedDate < now)
    } else {
      setIsPastDate(false)
    }
  }, [startDate])

  return (
    <div className="space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-md dark:bg-blue-900/20 dark:border-blue-800">
      <div className="text-sm text-blue-800 mb-3 dark:text-blue-300">
        <strong>Date & Time:</strong> Enter times in Eastern Time (New York)
      </div>

      <div>
        <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
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

        {isPastDate && (
          <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded-md dark:bg-yellow-900/20 dark:border-yellow-800">
            <div className="flex items-start">
              <svg className="h-5 w-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                <strong>Warning:</strong> You've selected a date/time in the past.
              </p>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="duration_minutes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Duration {required && <span className="text-red-500">*</span>}
        </label>
        <div className="mt-1">
          <DurationInput
            id="duration_minutes"
            value={durationMinutes}
            onChange={onDurationChange}
            required={required}
            disabled={disabled}
            minMinutes={1}
            roundToNearest={1}
          />
        </div>
      </div>
    </div>
  )
}
