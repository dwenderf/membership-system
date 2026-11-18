// Pure helpers for Xero refresh-token lifetime. Kept free of server-only
// imports (xero-node, logger) so client components can use them too.

// Xero refresh tokens last 60 days and are rolled forward on every refresh.
export const REFRESH_TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000

// Warn on the admin page when the refresh token expires within this window.
export const REFRESH_TOKEN_WARNING_MS = 7 * 24 * 60 * 60 * 1000

// Refresh token expiration: 60 days from the last refresh. Pass the token
// row's `updated_at`, not `created_at`: the row is updated in place on every
// refresh and on reconnect, so `created_at` stays at the original connect date.
export function calculateRefreshTokenExpiration(updatedAt: string): Date {
  return new Date(new Date(updatedAt).getTime() + REFRESH_TOKEN_LIFETIME_MS)
}

export function isRefreshTokenExpired(updatedAt: string, now: Date = new Date()): boolean {
  return now >= calculateRefreshTokenExpiration(updatedAt)
}

export function isRefreshTokenExpiringSoon(updatedAt: string, now: Date = new Date()): boolean {
  return calculateRefreshTokenExpiration(updatedAt).getTime() < now.getTime() + REFRESH_TOKEN_WARNING_MS
}
