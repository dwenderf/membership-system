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
export function formatDate(date: Date | string | number): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return dateObj.toLocaleDateString('en-US', { timeZone: APP_TIMEZONE })
}

/**
 * Formats a time in the app's timezone
 * @param date - Date object, ISO string, or timestamp
 * @param options - Additional time formatting options
 * @returns Formatted time string (e.g., "2:11 PM")
 */
export function formatTime(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
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
export function formatDateTime(date: Date | string | number): string {
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