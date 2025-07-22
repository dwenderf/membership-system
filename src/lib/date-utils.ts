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
  
  // Debug: log what we're getting
  console.log('formatTimestamp input:', timestamp)
  
  const date = new Date(timestamp)
  console.log('parsed date:', date)
  console.log('date.getHours():', date.getHours())
  console.log('date.toString():', date.toString())
  
  // Simple approach: just use toLocaleString() which should work the same as datetime-local inputs
  const result = date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric', 
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
  
  console.log('formatTimestamp result:', result)
  return result
}