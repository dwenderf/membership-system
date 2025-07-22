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
 * using native JavaScript timezone conversion (handles all edge cases properly)
 */
export function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Not set'
  
  // Parse timestamp and use native toLocaleString for proper timezone conversion
  const date = new Date(timestamp)
  
  // Use native Intl.DateTimeFormat for reliable timezone conversion
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }).format(date)
}