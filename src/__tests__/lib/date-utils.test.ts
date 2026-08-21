/**
 * Tests for date utility functions
 */

import {
  formatDate,
  formatTime,
  formatDateTime,
  formatEventDateTime,
  formatDateString,
  toNYDateString,
  convertToNYTimezone,
  convertFromUTCToNYDateTimeLocal,
} from '@/lib/date-utils'

describe('Date Utility Functions', () => {
  describe('formatDate', () => {
    it('should format a valid Date object', () => {
      const date = new Date('2025-09-21T20:00:00Z')
      const result = formatDate(date)
      expect(result).toBeTruthy()
      expect(result).not.toBe('N/A')
      expect(result).not.toBe('Invalid Date')
    })

    it('should format a valid ISO string', () => {
      const result = formatDate('2025-09-21T20:00:00Z')
      expect(result).toBeTruthy()
      expect(result).not.toBe('N/A')
      expect(result).not.toBe('Invalid Date')
    })

    it('should format a valid timestamp number', () => {
      const timestamp = new Date('2025-09-21T20:00:00Z').getTime()
      const result = formatDate(timestamp)
      expect(result).toBeTruthy()
      expect(result).not.toBe('N/A')
      expect(result).not.toBe('Invalid Date')
    })

    it('should return "N/A" for null', () => {
      const result = formatDate(null)
      expect(result).toBe('N/A')
    })

    it('should return "N/A" for undefined', () => {
      const result = formatDate(undefined)
      expect(result).toBe('N/A')
    })

    it('should return "Invalid Date" for invalid date string', () => {
      const result = formatDate('not-a-date')
      expect(result).toBe('Invalid Date')
    })

    it('should return "N/A" for NaN', () => {
      const result = formatDate(NaN)
      expect(result).toBe('N/A')
    })
  })

  describe('formatTime', () => {
    it('should format time from a valid Date object', () => {
      const date = new Date('2025-09-21T20:00:00Z')
      const result = formatTime(date)
      expect(result).toBeTruthy()
      expect(result).not.toBe('N/A')
      expect(result).not.toBe('Invalid Time')
      expect(result).toMatch(/\d{1,2}:\d{2}\s?[AP]M/i) // Matches time format like "4:00 PM"
    })

    it('should format time from a valid ISO string', () => {
      const result = formatTime('2025-09-21T20:00:00Z')
      expect(result).toBeTruthy()
      expect(result).not.toBe('N/A')
      expect(result).not.toBe('Invalid Time')
    })

    it('should return "N/A" for null', () => {
      const result = formatTime(null)
      expect(result).toBe('N/A')
    })

    it('should return "N/A" for undefined', () => {
      const result = formatTime(undefined)
      expect(result).toBe('N/A')
    })

    it('should return "Invalid Time" for invalid date string', () => {
      const result = formatTime('not-a-date')
      expect(result).toBe('Invalid Time')
    })

    it('should accept custom formatting options', () => {
      const date = new Date('2025-09-21T20:00:00Z')
      const result = formatTime(date, { hour12: false })
      expect(result).toBeTruthy()
      expect(result).not.toBe('N/A')
    })
  })

  describe('formatDateTime', () => {
    it('should format date and time from a valid Date object', () => {
      const date = new Date('2025-09-21T20:00:00Z')
      const result = formatDateTime(date)
      expect(result).toBeTruthy()
      expect(result).toContain(' at ')
      expect(result).not.toBe('N/A')
    })

    it('should format date and time from a valid ISO string', () => {
      const result = formatDateTime('2025-09-21T20:00:00Z')
      expect(result).toBeTruthy()
      expect(result).toContain(' at ')
      expect(result).not.toBe('N/A')
    })

    it('should return "N/A" for null', () => {
      const result = formatDateTime(null)
      expect(result).toBe('N/A')
    })

    it('should return "N/A" for undefined', () => {
      const result = formatDateTime(undefined)
      expect(result).toBe('N/A')
    })

    it('should handle invalid dates gracefully', () => {
      const result = formatDateTime('not-a-date')
      // Should contain "Invalid" somewhere since both formatDate and formatTime return "Invalid X"
      expect(result).toContain('Invalid')
    })
  })

  describe('formatEventDateTime', () => {
    it('should format event date/time with day of week', () => {
      const date = new Date('2025-09-21T20:00:00Z')
      const result = formatEventDateTime(date)
      expect(result).toBeTruthy()
      expect(result).toContain('@')
      expect(result).not.toBe('N/A')
      expect(result).not.toBe('Invalid Date')
      // Should contain a day of week (e.g., "Sunday", "Monday", etc.)
      expect(result).toMatch(/(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/)
    })

    it('should format from ISO string', () => {
      const result = formatEventDateTime('2025-09-21T20:00:00Z')
      expect(result).toBeTruthy()
      expect(result).toContain('@')
      expect(result).not.toBe('N/A')
    })

    it('should return "N/A" for null', () => {
      const result = formatEventDateTime(null)
      expect(result).toBe('N/A')
    })

    it('should return "N/A" for undefined', () => {
      const result = formatEventDateTime(undefined)
      expect(result).toBe('N/A')
    })

    it('should return "Invalid Date" for invalid date string', () => {
      const result = formatEventDateTime('not-a-date')
      expect(result).toBe('Invalid Date')
    })
  })

  describe('formatDateString', () => {
    it('should format a YYYY-MM-DD string correctly', () => {
      const result = formatDateString('2025-09-21')
      expect(result).toBeTruthy()
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/) // Matches MM/DD/YYYY or M/D/YYYY format
    })

    it('should handle different date strings', () => {
      const result = formatDateString('2025-01-01')
      expect(result).toBeTruthy()
    })
  })

  describe('toNYDateString', () => {
    it('should format date in NY timezone', () => {
      const date = new Date('2025-09-21T20:00:00Z')
      const result = toNYDateString(date)
      expect(result).toBeTruthy()
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })

    it('should format from ISO string', () => {
      const result = toNYDateString('2025-09-21T20:00:00Z')
      expect(result).toBeTruthy()
    })

    it('should use current date when no argument provided', () => {
      const result = toNYDateString()
      expect(result).toBeTruthy()
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
  })

  describe('convertToNYTimezone', () => {
    it('should return an empty string for an empty input', () => {
      expect(convertToNYTimezone('')).toBe('')
    })

    it('should convert an EST (winter) NY wall-clock time to the correct UTC instant', () => {
      // NY is UTC-5 in January (standard time), so noon NY -> 17:00 UTC.
      const result = convertToNYTimezone('2026-01-15T12:00')
      expect(result).toBe('2026-01-15T17:00:00.000Z')
    })

    it('should convert an EDT (summer) NY wall-clock time to the correct UTC instant', () => {
      // NY is UTC-4 in July (daylight time), so noon NY -> 16:00 UTC.
      const result = convertToNYTimezone('2026-07-15T12:00')
      expect(result).toBe('2026-07-15T16:00:00.000Z')
    })
  })

  describe('convertFromUTCToNYDateTimeLocal', () => {
    it('should return an empty string for an empty input', () => {
      expect(convertFromUTCToNYDateTimeLocal('')).toBe('')
    })

    it('should convert a UTC instant back to NY wall-clock time in winter (EST)', () => {
      const result = convertFromUTCToNYDateTimeLocal('2026-01-15T17:00:00.000Z')
      expect(result).toBe('2026-01-15T12:00')
    })

    it('should convert a UTC instant back to NY wall-clock time in summer (EDT)', () => {
      const result = convertFromUTCToNYDateTimeLocal('2026-07-15T16:00:00.000Z')
      expect(result).toBe('2026-07-15T12:00')
    })

    it('should round-trip through convertToNYTimezone without drift across the DST boundary', () => {
      const winterInput = '2026-01-15T12:00'
      const summerInput = '2026-07-15T12:00'

      expect(convertFromUTCToNYDateTimeLocal(convertToNYTimezone(winterInput))).toBe(winterInput)
      expect(convertFromUTCToNYDateTimeLocal(convertToNYTimezone(summerInput))).toBe(summerInput)
    })
  })

  describe('Edge cases and regression tests', () => {
    it('should handle dates with different timezones consistently', () => {
      const date1 = new Date('2025-09-21T00:00:00-04:00')
      const date2 = new Date('2025-09-21T04:00:00Z')

      const result1 = formatDate(date1)
      const result2 = formatDate(date2)

      // Both should produce valid date strings (they represent the same moment in time)
      expect(result1).toBeTruthy()
      expect(result2).toBeTruthy()
      expect(result1).toBe(result2)
    })

    it('should handle the specific production bug case', () => {
      // This simulates the production bug where undefined was passed
      const gameCreatedAt = undefined
      const result = formatDate(gameCreatedAt)

      // Should not crash and should return a safe value
      expect(result).toBe('N/A')
    })

    it('should handle null values from database queries', () => {
      // Simulates game_date being null in database
      const gameDate = null
      const result = formatDate(gameDate)

      expect(result).toBe('N/A')
    })
  })
})
