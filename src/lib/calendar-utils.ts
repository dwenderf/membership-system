/**
 * Calendar utilities for generating iCal files and Google Calendar URLs
 * for event and scrimmage registrations
 */

/**
 * App-wide timezone configuration
 * Falls back to America/New_York if not set
 */
const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'America/New_York'

/**
 * Generate a cryptographically secure UUID
 * Uses crypto.randomUUID() if available, with fallback for older browsers
 * @returns A UUID string
 * @throws Error if no cryptographically secure random source is available
 */
function generateSecureUUID(): string {
  // Try to use crypto.randomUUID() if available (Node 15.6+ / modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback for older browsers using crypto.getRandomValues()
  // This is RFC 4122 version 4 compliant
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] % 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // No cryptographically secure random source available
  throw new Error('Cryptographically secure random number generator not available')
}

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
 * Format a date to iCal format in the app's timezone (YYYYMMDDTHHMMSS)
 * Note: Does not include 'Z' suffix as these are timezone-specific, not UTC
 * @param date - Date object or ISO string
 * @returns Formatted date string for iCal
 */
function formatICalDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date

  // Get date/time components in app's timezone
  const dateString = d.toLocaleString('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

  // Parse the formatted string (format: "MM/DD/YYYY, HH:mm:ss")
  const [datePart, timePart] = dateString.split(', ')
  const [month, day, year] = datePart.split('/')
  const [hour, minute, second] = timePart.split(':')

  return `${year}${month}${day}T${hour}${minute}${second}`
}

/**
 * Generate VTIMEZONE component for America/New_York
 * Includes both EST (Standard) and EDT (Daylight) definitions
 * @returns VTIMEZONE component as string array
 */
function generateVTimezone(): string[] {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  ]
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
  const uid = `${generateSecureUUID()}@membership-system`

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
    ...generateVTimezone(),
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${APP_TIMEZONE}:${dtstart}`,
    `DTEND;TZID=${APP_TIMEZONE}:${dtend}`,
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

  // Format dates in app timezone (YYYYMMDDTHHMMSS)
  const formatGoogleDate = (date: Date): string => {
    return formatICalDate(date)
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventName,
    dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`,
    ctz: APP_TIMEZONE, // Specify timezone for the event
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
