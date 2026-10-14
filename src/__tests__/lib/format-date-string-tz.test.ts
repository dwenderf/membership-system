/**
 * #410: formatDateString must show a YYYY-MM-DD calendar date as that same day
 * on every host timezone (Vercel/CI run in UTC). Node re-reads process.env.TZ
 * on assignment, so this pins behaviour across zones in a single run; CI also
 * runs the whole suite under several TZ values.
 */
import { formatDateString, formatDate } from '@/lib/date-utils'

const ZONES = ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Tokyo']
const ORIGINAL_TZ = process.env.TZ

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe.each(ZONES)('formatDateString with host TZ=%s', (zone) => {
  beforeAll(() => { process.env.TZ = zone })

  it('shows the prod incident date unchanged (11/11/2026, not 11/10)', () => {
    expect(formatDateString('2026-11-11')).toBe('11/11/2026')
  })

  it.each([
    ['2026-01-01', '1/1/2026'],
    ['2026-12-31', '12/31/2026'],
    ['2027-06-30', '6/30/2027'],
    ['2028-02-29', '2/29/2028'],
    ['2026-03-08', '3/8/2026'], // US DST start
    ['2026-11-01', '11/1/2026'], // US DST end
  ])('%s -> %s', (input, expected) => {
    expect(formatDateString(input)).toBe(expected)
  })

  it('treats full timestamps as instants shown in America/New_York', () => {
    // 03:00Z on Nov 11 is still Nov 10 in New York.
    expect(formatDateString('2026-11-11T03:00:00Z')).toBe('11/10/2026')
    expect(formatDateString('2026-11-11T17:00:00+00:00')).toBe('11/11/2026')
    expect(formatDateString('2026-11-11T03:00:00Z')).toBe(formatDate('2026-11-11T03:00:00Z'))
  })

  it('returns N/A for empty values', () => {
    expect(formatDateString('')).toBe('N/A')
    expect(formatDateString(null)).toBe('N/A')
    expect(formatDateString(undefined)).toBe('N/A')
  })
})
