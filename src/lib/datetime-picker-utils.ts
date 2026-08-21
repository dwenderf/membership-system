// Parses "YYYY-MM-DD" / "YYYY-MM-DDTHH:MM" value strings (as produced by
// DateTimePicker's onChange handler) into a local Date. Handing flatpickr the
// raw string instead (via setDate/parseDate with no explicit format) makes it
// parse using the display dateFormat (e.g. "M j, Y \\a\\t h:i K"), which
// doesn't match this shape and silently fails, leaving the field blank.
export function parseValueToDate(value: string): Date | null {
  if (!value) return null
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  if (timePart) {
    const [hours, minutes] = timePart.split(':').map(Number)
    return new Date(year, month - 1, day, hours, minutes)
  }
  return new Date(year, month - 1, day)
}
