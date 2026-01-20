'use client'

import { useState, useEffect } from 'react'

interface DurationInputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  required?: boolean
  disabled?: boolean
  className?: string
  minMinutes?: number
  roundToNearest?: number
}

/**
 * DurationInput - A reusable input for duration in minutes
 *
 * Features:
 * - Prevents negative values
 * - Automatically rounds floats to nearest integer
 * - Enforces minimum duration (default 1 minute)
 * - Displays hours and minutes for better readability
 *
 * @example
 * ```tsx
 * <DurationInput
 *   value={durationMinutes}
 *   onChange={setDurationMinutes}
 *   required={true}
 * />
 * ```
 */
export default function DurationInput({
  value,
  onChange,
  id = 'duration_minutes',
  required = false,
  disabled = false,
  className = '',
  minMinutes = 1,
  roundToNearest = 5,
}: DurationInputProps) {
  const [localValue, setLocalValue] = useState(value)
  const [error, setError] = useState<string | null>(null)

  // Update local value when prop changes
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Clear error message after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Round to nearest integer
  const roundValue = (val: string): string => {
    if (!val || val === '') return ''

    const numValue = parseFloat(val)

    // Check if it's a valid number
    if (isNaN(numValue)) return ''

    // Prevent negative values
    if (numValue < 0) return String(minMinutes)

    // Round to nearest integer
    const rounded = Math.round(numValue)

    // Enforce minimum
    if (rounded < minMinutes) return String(minMinutes)

    return String(rounded)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value

    // Allow empty string while typing
    if (newValue === '') {
      setLocalValue('')
      setError(null)
      return
    }

    // Parse and validate
    const numValue = parseFloat(newValue)

    // Check if it's a valid number
    if (isNaN(numValue)) {
      setError('Please enter a valid number')
      return
    }

    // Prevent negative values during input
    if (numValue < 0) {
      setError('Duration cannot be negative')
      return
    }

    setError(null)
    setLocalValue(newValue)
  }

  const handleBlur = () => {
    if (localValue === '') {
      onChange('')
      return
    }

    const rounded = roundValue(localValue)
    setLocalValue(rounded)
    onChange(rounded)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Round and commit on Enter
    if (e.key === 'Enter') {
      handleBlur()
    }
  }

  // Format hours and minutes for display
  const formatDuration = (minutes: string): string => {
    if (!minutes || minutes === '') return ''
    const min = parseInt(minutes)
    const hours = Math.floor(min / 60)
    const mins = min % 60
    return `${hours}h ${mins}m`
  }

  return (
    <div>
      <div className="flex items-center space-x-2">
        <input
          type="text"
          inputMode="numeric"
          id={id}
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`block w-32 rounded-md shadow-sm sm:text-sm ${
            error
              ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 dark:border-red-600 dark:text-red-300'
              : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white'
          } ${className}`}
          required={required}
          disabled={disabled}
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">minutes</span>
        {localValue && localValue !== '' && !error && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            ({formatDuration(localValue)})
          </span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
