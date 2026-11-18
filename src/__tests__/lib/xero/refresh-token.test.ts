import {
  calculateRefreshTokenExpiration,
  isRefreshTokenExpired,
  isRefreshTokenExpiringSoon,
  REFRESH_TOKEN_LIFETIME_MS,
} from '@/lib/xero/refresh-token'

const DAY = 24 * 60 * 60 * 1000
const updatedAt = '2026-11-17T17:39:00.000Z'
const now = new Date('2026-11-17T18:00:00.000Z')

describe('refresh token expiry', () => {
  it('is 60 days after the last refresh', () => {
    expect(REFRESH_TOKEN_LIFETIME_MS).toBe(60 * DAY)
    expect(calculateRefreshTokenExpiration(updatedAt).toISOString()).toBe('2027-01-16T17:39:00.000Z')
  })

  it('is not expired or expiring soon right after a refresh', () => {
    expect(isRefreshTokenExpired(updatedAt, now)).toBe(false)
    expect(isRefreshTokenExpiringSoon(updatedAt, now)).toBe(false)
  })

  it('flags expiry within 7 days', () => {
    const later = new Date(new Date(updatedAt).getTime() + 53 * DAY)
    expect(isRefreshTokenExpiringSoon(updatedAt, later)).toBe(false)
    const closer = new Date(new Date(updatedAt).getTime() + 53 * DAY + 1)
    expect(isRefreshTokenExpiringSoon(updatedAt, closer)).toBe(true)
  })

  it('is expired after 60 days', () => {
    const past = new Date(new Date(updatedAt).getTime() + 60 * DAY)
    expect(isRefreshTokenExpired(updatedAt, past)).toBe(true)
  })
})
