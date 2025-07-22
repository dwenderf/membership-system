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
 * using the exact same UTC to local conversion logic as the timing edit page
 */
export function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Not set'
  
  // Use the exact same logic as the timing edit page formatForInput function
  const date = new Date(timestamp)
  
  // Extract local timezone components exactly like timing edit page (lines 51-55)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0') 
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  
  // This gives us the local time components that the timing edit page uses
  const localHours = parseInt(hours)
  const localMinutes = parseInt(minutes)
  
  // Format for display
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]
  
  // Convert to 12-hour format
  const hour12 = localHours === 0 ? 12 : localHours > 12 ? localHours - 12 : localHours
  const ampm = localHours >= 12 ? 'PM' : 'AM'
  const minutesDisplay = String(localMinutes).padStart(2, '0')
  
  return `${monthNames[parseInt(month) - 1]} ${parseInt(day)}, ${year}, ${hour12}:${minutesDisplay} ${ampm}`
}