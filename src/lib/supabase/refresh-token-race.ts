/**
 * Supabase rotates refresh tokens on every use. When two requests race to
 * refresh the same stale cookie (tab refocus, prefetch + navigation, etc.),
 * the loser gets `AuthApiError: Invalid Refresh Token: Already Used`
 * (code `refresh_token_already_used`). That code can only happen when a
 * refresh token that *was* valid a moment ago got consumed twice - unlike
 * an expired/revoked/absent session, it doesn't mean the user is logged
 * out, just that this particular request lost the race.
 *
 * See https://github.com/dwenderf/membership-system/issues/393.
 */
export function isRefreshTokenAlreadyUsedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'refresh_token_already_used'
  )
}

/**
 * Guards the one-time soft retry in proxy.ts against looping forever if the
 * race keeps recurring for the same navigation. Short-lived: it only needs
 * to survive the single redirect round-trip back to the same URL.
 */
export const REFRESH_RETRY_GUARD_COOKIE = 'sb-refresh-retry-guard'
export const REFRESH_RETRY_GUARD_MAX_AGE_SECONDS = 10
