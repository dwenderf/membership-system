/**
 * Helpers for passkey (WebAuthn) support detection, error classification,
 * and the dashboard setup-banner snooze schedule.
 *
 * Supabase wraps browser WebAuthn failures in a WebAuthnError with a `code`
 * property and returns them (rather than throwing), but we also check the
 * underlying DOMException names defensively.
 */

export interface PasskeyPromptPrefs {
  snoozedUntil?: string
  dismissCount?: number
  optedOut?: boolean
}

/** Snooze ladder in days: 1st dismissal -> 7, 2nd -> 30, 3rd+ -> 90 */
const SNOOZE_LADDER_DAYS = [7, 30, 90]

export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential
}

function getErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  return (error as { name?: string }).name
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  return (error as { code?: string }).code
}

function getErrorCause(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined
  return (error as { cause?: unknown }).cause
}

/** User cancelled the OS passkey dialog or it timed out — handle silently */
export function isUserCancelledError(error: unknown): boolean {
  if (!error) return false
  if (getErrorCode(error) === 'ERROR_CEREMONY_ABORTED') return true
  const name = getErrorName(error)
  if (name === 'NotAllowedError' || name === 'AbortError') return true
  const cause = getErrorCause(error)
  if (cause) {
    const causeName = getErrorName(cause)
    if (causeName === 'NotAllowedError' || causeName === 'AbortError') return true
  }
  return false
}

/** This authenticator already has a passkey for this account */
export function isDuplicateRegistrationError(error: unknown): boolean {
  if (!error) return false
  if (getErrorCode(error) === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return true
  return getErrorName(error) === 'InvalidStateError' || getErrorName(getErrorCause(error)) === 'InvalidStateError'
}

/** Passkeys can't work on this origin (e.g. RP ID mismatch on preview deploys) */
export function isUnsupportedOriginError(error: unknown): boolean {
  if (!error) return false
  const code = getErrorCode(error)
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID') return true
  return getErrorName(error) === 'SecurityError' || getErrorName(getErrorCause(error)) === 'SecurityError'
}

/**
 * Best-effort guess at where a passkey is stored, from its auto-derived
 * friendly name (AAGUID-based, e.g. "Apple Passwords"). Renamed passkeys
 * fall through to the generic hint.
 */
export function getPasskeyStorageHint(friendlyName: string | undefined | null): string {
  const name = (friendlyName || '').toLowerCase()
  if (name.includes('apple') || name.includes('icloud')) return 'the Apple Passwords app on your iPhone or Mac'
  if (name.includes('google') || name.includes('chrome')) return 'Google Password Manager'
  if (name.includes('1password')) return '1Password'
  if (name.includes('bitwarden')) return 'Bitwarden'
  if (name.includes('windows') || name.includes('microsoft')) return 'Windows Hello'
  return 'your password manager'
}

/** Days until the next banner prompt after the (dismissCount + 1)th dismissal */
export function getNextSnoozeDays(dismissCount: number): number {
  const index = Math.min(Math.max(dismissCount, 0), SNOOZE_LADDER_DAYS.length - 1)
  return SNOOZE_LADDER_DAYS[index]
}

/** ISO timestamp for when the banner should next appear */
export function getNextSnoozeDate(dismissCount: number, from: Date = new Date()): string {
  const next = new Date(from)
  next.setDate(next.getDate() + getNextSnoozeDays(dismissCount))
  return next.toISOString()
}

/** Whether the dashboard banner is eligible to show, based on stored prefs */
export function isPasskeyPromptEligible(prefs: PasskeyPromptPrefs | undefined | null, now: Date = new Date()): boolean {
  if (!prefs) return true
  if (prefs.optedOut) return false
  if (prefs.snoozedUntil && new Date(prefs.snoozedUntil) > now) return false
  return true
}
