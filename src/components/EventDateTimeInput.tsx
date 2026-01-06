'use client'

import { useState } from 'react'

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
  return (
    <div className="space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
      <div className="text-sm text-blue-800 mb-3">
        <strong>Date & Time:</strong> Enter times in Eastern Time (New York)
      </div>

      <div>
        <label htmlFor="start_date" className="block text-sm font-medium text-gray-700">
          Start Date & Time {required && <span className="text-red-500">*</span>}
        </label>
        <input
          type="datetime-local"
          id="start_date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          step="300"
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          required={required}
          disabled={disabled}
        />
        <p className="mt-1 text-xs text-gray-500">5-minute increments</p>
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
            min="5"
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
