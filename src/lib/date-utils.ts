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