'use client'

import { useEffect, useRef } from 'react'
import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.min.css'
import { Instance } from 'flatpickr/dist/types/instance'

interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  enableTime?: boolean
  minuteIncrement?: number
  minDate?: Date | string
  maxDate?: Date | string
  mode?: 'single' | 'multiple' | 'range'
}

/**
 * DateTimePicker - A reusable date/time picker component using Flatpickr
 *
 * Provides a consistent, cross-browser date/time picking experience with:
 * - 5-minute increments by default
 * - 12-hour time format with AM/PM
 * - Eastern Time display (handled by parent component via value conversion)
 * - Mobile-friendly UI
 *
 * @example
 * ```tsx
 * <DateTimePicker
 *   value={formData.startDate}
 *   onChange={(value) => setFormData(prev => ({ ...prev, startDate: value }))}
 *   enableTime={true}
 *   required={true}
 * />
 * ```
 */
export default function DateTimePicker({
  value,
  onChange,
  id,
  placeholder = 'Select date...',
  required = false,
  disabled = false,
  className = '',
  enableTime = true,
  minuteIncrement = 5,
  minDate,
  maxDate,
  mode = 'single',
}: DateTimePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const flatpickrRef = useRef<Instance | null>(null)

  useEffect(() => {
    if (!inputRef.current) return

    // Initialize flatpickr
    flatpickrRef.current = flatpickr(inputRef.current, {
      enableTime,
      time_24hr: false,
      minuteIncrement,
      dateFormat: enableTime ? 'Y-m-d h:i K' : 'Y-m-d',
      altInput: true,
      altFormat: enableTime ? 'M j, Y at h:i K' : 'M j, Y',
      minDate,
      maxDate,
      mode,
      onChange: (selectedDates, dateStr) => {
        // Convert to datetime-local format (YYYY-MM-DDTHH:MM)
        if (selectedDates.length > 0) {
          const date = selectedDates[0]
          const year = date.getFullYear()
          const month = String(date.getMonth() + 1).padStart(2, '0')
          const day = String(date.getDate()).padStart(2, '0')

          if (enableTime) {
            const hours = String(date.getHours()).padStart(2, '0')
            const minutes = String(date.getMinutes()).padStart(2, '0')
            onChange(`${year}-${month}-${day}T${hours}:${minutes}`)
          } else {
            onChange(`${year}-${month}-${day}`)
          }
        } else {
          onChange('')
        }
      },
    })

    // Set initial value if provided
    if (value) {
      flatpickrRef.current.setDate(value, false)
    }

    // Cleanup
    return () => {
      if (flatpickrRef.current) {
        flatpickrRef.current.destroy()
      }
    }
  }, []) // Only run once on mount

  // Update flatpickr when value changes externally
  useEffect(() => {
    if (!flatpickrRef.current) return

    // Compare the selected dates (parsed Date objects) instead of string representations
    // to avoid format mismatch issues (value is in datetime-local format YYYY-MM-DDTHH:MM,
    // while flatpickr.input.value is in dateFormat which is YYYY-MM-DD HH:MM K)
    const valueAsDate = value ? flatpickrRef.current.parseDate(value) : null
    const currentSelectedDate =
      flatpickrRef.current.selectedDates.length > 0
        ? flatpickrRef.current.selectedDates[0]
        : null

    // Check if the dates are actually different
    const datesAreDifferent =
      (valueAsDate === null) !== (currentSelectedDate === null) ||
      (valueAsDate &&
        currentSelectedDate &&
        valueAsDate.getTime() !== currentSelectedDate.getTime())

    if (datesAreDifferent) {
      if (value) {
        flatpickrRef.current.setDate(value, false)
      } else {
        flatpickrRef.current.clear()
      }
    }
  }, [value])

  // Update disabled state
  useEffect(() => {
    if (flatpickrRef.current) {
      if (disabled) {
        flatpickrRef.current.altInput?.setAttribute('disabled', 'disabled')
      } else {
        flatpickrRef.current.altInput?.removeAttribute('disabled')
      }
    }
  }, [disabled])

  return (
    <input
      ref={inputRef}
      type="text"
      id={id}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 ${className}`}
    />
  )
}
