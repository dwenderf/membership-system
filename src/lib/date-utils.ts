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
 * using the EXACT same logic as the timing edit page formatForInput function
 */
export function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Not set'
  
  // Use the EXACT same formatForInput logic from timing edit page
  const date = new Date(timestamp)
  // Convert to local timezone and format for datetime-local input
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const datetimeLocal = `${year}-${month}-${day}T${hours}:${minutes}`
  
  // Parse the datetime-local string back to a Date for display formatting
  const localDate = new Date(datetimeLocal)
  
  // Format for display - this should match what the timing edit form shows
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const displayHour = localDate.getHours()
  const hour12 = displayHour === 0 ? 12 : displayHour > 12 ? displayHour - 12 : displayHour
  const ampm = displayHour >= 12 ? 'PM' : 'AM'
  
  return `${monthNames[localDate.getMonth()]} ${localDate.getDate()}, ${localDate.getFullYear()}, ${hour12}:${String(localDate.getMinutes()).padStart(2, '0')} ${ampm}`
}