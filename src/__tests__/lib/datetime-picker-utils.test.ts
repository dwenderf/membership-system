/**
 * Tests for DateTimePicker's date-string parsing helper
 */

import { parseValueToDate } from '@/lib/datetime-picker-utils'

describe('parseValueToDate', () => {
  it('should return null for an empty string', () => {
    expect(parseValueToDate('')).toBeNull()
  })

  it('should parse a date-only value without misreading day as month', () => {
    // Regression case: 25 is not a valid month, so a day/month swap would be
    // immediately detectable here.
    const result = parseValueToDate('2026-08-25')
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2026)
    expect(result!.getMonth()).toBe(7) // August, 0-indexed
    expect(result!.getDate()).toBe(25)
    expect(result!.getHours()).toBe(0)
    expect(result!.getMinutes()).toBe(0)
  })

  it('should parse a datetime-local value with hours and minutes', () => {
    const result = parseValueToDate('2026-08-25T14:30')
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2026)
    expect(result!.getMonth()).toBe(7)
    expect(result!.getDate()).toBe(25)
    expect(result!.getHours()).toBe(14)
    expect(result!.getMinutes()).toBe(30)
  })

  it('should not swap day and month even when both are valid months', () => {
    // Regression case: both 3 (month) and 4 (day) are valid months, so an
    // accidental day/month swap here would silently produce a wrong-but-valid
    // date (April 3) instead of throwing.
    const result = parseValueToDate('2026-03-04')
    expect(result).not.toBeNull()
    expect(result!.getMonth()).toBe(2) // March, 0-indexed
    expect(result!.getDate()).toBe(4)
  })

  it('should not misread zero-padded components', () => {
    const result = parseValueToDate('2026-01-05T09:05')
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2026)
    expect(result!.getMonth()).toBe(0) // January
    expect(result!.getDate()).toBe(5)
    expect(result!.getHours()).toBe(9)
    expect(result!.getMinutes()).toBe(5)
  })

  it('should parse midnight correctly', () => {
    const result = parseValueToDate('2026-01-01T00:00')
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2026)
    expect(result!.getMonth()).toBe(0)
    expect(result!.getDate()).toBe(1)
    expect(result!.getHours()).toBe(0)
    expect(result!.getMinutes()).toBe(0)
  })

  it('should parse a leap day without rolling over to March', () => {
    const result = parseValueToDate('2024-02-29')
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2024)
    expect(result!.getMonth()).toBe(1) // February
    expect(result!.getDate()).toBe(29)
  })
})
