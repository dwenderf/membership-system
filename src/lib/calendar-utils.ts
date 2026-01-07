/**
 * Calendar utilities for generating iCal files and Google Calendar URLs
 * for event and scrimmage registrations
 */

/**
 * Escape special characters in iCalendar text fields per RFC 5545
 * @param text - Text to escape
 * @returns Escaped text safe for iCalendar format
 */
function escapeICalText(text: string): string {
  // Must escape backslashes FIRST, then other special characters
  return text
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/\n/g, '\\n')   // Escape newlines
    .replace(/,/g, '\\,')    // Escape commas
    .replace(/;/g, '\\;')    // Escape semicolons
}

/**
 * Format a date to iCal format (YYYYMMDDTHHMMSSZ)
 * @param date - Date object or ISO string
 * @returns Formatted date string for iCal
 */
function formatICalDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date

  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hours = String(d.getUTCHours()).padStart(2, '0')
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')
  const seconds = String(d.getUTCSeconds()).padStart(2, '0')

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`
}

/**
 * Generate iCal (ICS) file content for an event or scrimmage
 * @param eventName - Name of the event/scrimmage
 * @param startDate - Start date (UTC ISO string)
 * @param endDate - End date (UTC ISO string)
 * @param description - Optional description
 * @param location - Optional location
 * @returns iCal file content as string
 */
export function generateICalContent(
  eventName: string,
  startDate: string,
  endDate: string,
  description?: string,
  location?: string
): string {
  const now = new Date()
  const dtstamp = formatICalDate(now)
  const dtstart = formatICalDate(startDate)
  const dtend = formatICalDate(endDate)

  // Generate a cryptographically secure unique ID for this event
  const uid = `${crypto.randomUUID()}@membership-system`

  // Escape special characters in text fields per RFC 5545
  const escapedName = escapeICalText(eventName)
  const escapedDescription = description ? escapeICalText(description) : ''
  const escapedLocation = location ? escapeICalText(location) : ''

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Membership System//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapedName}`,
  ]

  if (escapedDescription) {
    lines.push(`DESCRIPTION:${escapedDescription}`)
  }

  if (escapedLocation) {
    lines.push(`LOCATION:${escapedLocation}`)
  }

  lines.push('STATUS:CONFIRMED')
  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n')
}

/**
 * Generate a Google Calendar URL for adding an event
 * @param eventName - Name of the event/scrimmage
 * @param startDate - Start date (UTC ISO string)
 * @param endDate - End date (UTC ISO string)
 * @param description - Optional description
 * @param location - Optional location
 * @returns Google Calendar URL
 */
export function generateGoogleCalendarUrl(
  eventName: string,
  startDate: string,
  endDate: string,
  description?: string,
  location?: string
): string {
  const start = new Date(startDate)
  const end = new Date(endDate)

  // Format dates as YYYYMMDDTHHmmssZ for Google Calendar
  const formatGoogleDate = (date: Date): string => {
    return formatICalDate(date)
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventName,
    dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`,
  })

  if (description) {
    params.append('details', description)
  }

  if (location) {
    params.append('location', location)
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Download an iCal file to the user's device
 * @param content - iCal file content
 * @param filename - Filename for the download (should end with .ics)
 */
export function downloadICalFile(content: string, filename: string): void {
  // Ensure filename ends with .ics
  const icsFilename = filename.endsWith('.ics') ? filename : `${filename}.ics`

  // Create a blob with the iCal content
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })

  // Create a temporary link element and trigger download
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = icsFilename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // Clean up the URL object
  URL.revokeObjectURL(link.href)
}

/**
 * Generate a safe filename from event name
 * @param eventName - Name of the event
 * @returns Sanitized filename
 */
export function generateCalendarFilename(eventName: string): string {
  // Remove special characters and replace spaces with hyphens
  const sanitized = eventName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()

  return `${sanitized}.ics`
}
