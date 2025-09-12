/**
 * Formats a date string (YYYY-MM-DD) to localized date display
 * without timezone conversion issues
 */
export function formatDateString(dateString: string): string {
  // Split the date string and create date in local timezone
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  
  return date.toLocaleDateString()
}

/**
 * Formats a date object to localized date display
 * ensuring we use local date components
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString()
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
  
  // Create a date object representing this time in NY timezone
  // We'll use the Intl.DateTimeFormat trick to handle EST/EDT automatically
  const inputDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute))
  
  // Get the timezone offset for NY on this specific date
  const nyFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset'
  })
  
  const nyOffset = nyFormatter.formatToParts(inputDate)
    .find(part => part.type === 'timeZoneName')?.value || '-05:00'
  
  // Create the ISO string with NY timezone
  const isoString = `${datePart}T${timePart}:00${nyOffset}`
  
  // Convert to UTC and return ISO string
  return new Date(isoString).toISOString()
}