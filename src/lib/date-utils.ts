/**
 * App-wide timezone configuration
 * Falls back to America/New_York if not set
 */
const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'America/New_York'

/**
 * Formats a date string (YYYY-MM-DD) to localized date display
 * without timezone conversion issues
 */
export function formatDateString(dateString: string): string {
  // Split the date string and create date in local timezone
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed

  return date.toLocaleDateString('en-US', { timeZone: APP_TIMEZONE })
}

/**
 * Formats a date object to localized date display in the app's timezone
 */
export function formatDate(date: Date | string | number | null | undefined): string {
  if (!date) return 'N/A'
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  // Check if date is valid
  if (isNaN(dateObj.getTime())) return 'Invalid Date'
  return dateObj.toLocaleDateString('en-US', { timeZone: APP_TIMEZONE })
}

/**
 * Formats a time in the app's timezone
 * @param date - Date object, ISO string, or timestamp
 * @param options - Additional time formatting options
 * @returns Formatted time string (e.g., "2:11 PM")
 */
export function formatTime(
  date: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!date) return 'N/A'
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  // Check if date is valid
  if (isNaN(dateObj.getTime())) return 'Invalid Time'
  return dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIMEZONE,
    ...options
  })
}

/**
 * Formats both date and time in the app's timezone
 * @param date - Date object, ISO string, or timestamp
 * @returns Formatted date and time string (e.g., "10/23/2025 at 2:11 PM")
 */
export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return 'N/A'
  return `${formatDate(date)} at ${formatTime(date)}`
}

/**
 * Formats a timestamp string to localized date and time display
 * Should match what datetime-local input fields show
 */
export function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Not set'

  // Since this runs on server (UTC), return the raw timestamp for client-side rendering
  return timestamp
}

/**
 * Format a date to local date string in New York timezone
 * Used for email templates and consistent date display
 */
export function toNYDateString(date?: Date | string): string {
  const dateObj = date ? new Date(date) : new Date()
  return dateObj.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
}

/**
 * Convert datetime-local input to America/New_York timezone for database storage
 * Automatically handles EST/EDT based on the specific date
 * Used when storing user-entered datetime values that should be treated as NY time
 */
export function convertToNYTimezone(dateTimeLocal: string): string {
  if (!dateTimeLocal) return ''

  // Parse the datetime-local value (e.g., "2025-09-28T17:30")
  const [datePart, timePart] = dateTimeLocal.split('T')
  const [year, month, day] = datePart.split('-')
  const [hour, minute] = timePart.split(':')

  // Create two date objects - one interpreted as local time, one as NY time
  const localDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute))

  // Get what this same date/time would be in NY timezone
  const nyDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'America/New_York' }))

  // Calculate the difference between local and NY interpretations
  const offset = localDate.getTime() - nyDate.getTime()

  // Apply the offset to treat the input as NY time
  const correctedDate = new Date(localDate.getTime() + offset)

  return correctedDate.toISOString()
}

/**
 * Extract date portion (YYYY-MM-DD) from a Date object or ISO string
 * More explicit and safer than string splitting
 * @param date - Date object or ISO string
 * @returns Date string in YYYY-MM-DD format
 */
export function toDateString(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return dateObj.toISOString().substring(0, 10)
}

/**
 * Convert UTC ISO string to datetime-local input format (YYYY-MM-DDTHH:mm)
 * Displays the time in America/New_York timezone
 * Used when populating datetime-local input fields from database values
 * @param utcIsoString - UTC ISO string from database (e.g., "2025-09-28T21:30:00Z")
 * @returns Datetime-local format string (e.g., "2025-09-28T17:30")
 */
export function convertFromUTCToNYDateTimeLocal(utcIsoString: string): string {
  if (!utcIsoString) return ''

  const date = new Date(utcIsoString)

  // Get the date/time components in NY timezone
  const nyDateString = date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  // Parse the NY date string (format: "MM/DD/YYYY, HH:mm")
  const [datePart, timePart] = nyDateString.split(', ')
  const [month, day, year] = datePart.split('/')
  const [hour, minute] = timePart.split(':')

  // Return in datetime-local format (YYYY-MM-DDTHH:mm)
  return `${year}-${month}-${day}T${hour}:${minute}`
}

/**
 * Format event start date/time in a user-friendly way for dashboard display
 * @param date - Date object, ISO string, or timestamp
 * @returns Formatted string like "Sunday, Jan 11 @ 4:00pm" (no year)
 */
export function formatEventDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return 'N/A'
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date

  // Check if date is valid
  if (isNaN(dateObj.getTime())) return 'Invalid Date'

  const dayOfWeek = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: APP_TIMEZONE
  })

  const monthDay = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: APP_TIMEZONE
  })

  const time = dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIMEZONE,
    hour12: true
  }).toLowerCase()

  return `${dayOfWeek}, ${monthDay} @ ${time}`
}