/**
 * Turns a Supabase auth failure into something worth showing on the login screen.
 *
 * Two reasons not to render `error.message` straight through. It is provider
 * wording aimed at developers: an account whose auth record was removed while an
 * OAuth identity kept the address comes back as "User already registered", which
 * reads to the person typing their email as "you already have an account" when it
 * means very nearly the opposite. And it is a disclosure surface — an
 * unauthenticated form that says something different for addresses it knows tells
 * anyone who asks which addresses exist, which is why GoTrue keeps its own /otp
 * responses vague.
 *
 * So only failures the person can act on are named. Everything else collapses to
 * one message that points at support without confirming anything.
 */

export const SIGN_IN_EMAIL_ERROR =
  "We couldn't send a sign-in link to that address. If you previously deleted this " +
  'account, please contact support — otherwise try again, or sign in with Google.'

export const SIGN_IN_OAUTH_ERROR =
  "We couldn't start Google sign-in. Please try again."

export const NETWORK_ERROR =
  'Network error. Please check your connection and try again.'

export const RATE_LIMIT_ERROR =
  'Too many sign-in attempts. Please wait a minute and try again.'

function getMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return ''
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

function getCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Couldn't reach Supabase at all — worth distinguishing from a rejected request */
export function isNetworkError(error: unknown): boolean {
  const message = getMessage(error).toLowerCase()
  return message.includes('failed to fetch') || message.includes('network')
}

/** GoTrue is throttling this address or IP; waiting actually helps */
export function isRateLimited(error: unknown): boolean {
  if (getStatus(error) === 429) return true
  const code = getCode(error)
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return true
  return /you can only request this after/i.test(getMessage(error))
}

/**
 * The message to show. `fallback` is the domain-appropriate wording for the
 * sign-in method that failed — never the provider's own string.
 */
export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return NETWORK_ERROR
  if (isRateLimited(error)) return RATE_LIMIT_ERROR
  return fallback
}
