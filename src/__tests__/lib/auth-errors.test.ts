import {
  getAuthErrorMessage,
  isNetworkError,
  isRateLimited,
  NETWORK_ERROR,
  RATE_LIMIT_ERROR,
  SIGN_IN_EMAIL_ERROR,
  SIGN_IN_OAUTH_ERROR,
} from '@/lib/auth-errors'

describe('isNetworkError', () => {
  it('recognises a fetch failure', () => {
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('network request failed'))).toBe(true)
  })

  it('does not treat a rejected request as a network failure', () => {
    expect(isNetworkError({ message: 'User already registered', status: 422 })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

describe('isRateLimited', () => {
  it('recognises the status, the code, and the wording', () => {
    expect(isRateLimited({ message: 'nope', status: 429 })).toBe(true)
    expect(isRateLimited({ message: 'nope', code: 'over_email_send_rate_limit' })).toBe(true)
    expect(isRateLimited({ message: 'For security purposes, you can only request this after 51 seconds' })).toBe(true)
  })

  it('leaves other failures alone', () => {
    expect(isRateLimited({ message: 'User already registered', status: 422 })).toBe(false)
  })
})

describe('getAuthErrorMessage', () => {
  // The case that prompted this: a half-deleted account whose OAuth identity
  // still holds the address makes GoTrue answer /otp with "User already
  // registered", which is both misleading and an existence oracle.
  it('never leaks the provider string for a rejected sign-in', () => {
    const error = { message: 'User already registered', status: 422, code: 'user_already_exists' }
    const shown = getAuthErrorMessage(error, SIGN_IN_EMAIL_ERROR)

    expect(shown).toBe(SIGN_IN_EMAIL_ERROR)
    expect(shown).not.toContain('already registered')
  })

  it('uses the fallback given for the method that failed', () => {
    const error = { message: 'something internal', status: 500 }
    expect(getAuthErrorMessage(error, SIGN_IN_OAUTH_ERROR)).toBe(SIGN_IN_OAUTH_ERROR)
  })

  it('still names the failures a person can act on', () => {
    expect(getAuthErrorMessage(new Error('Failed to fetch'), SIGN_IN_EMAIL_ERROR)).toBe(NETWORK_ERROR)
    expect(getAuthErrorMessage({ status: 429, message: 'slow down' }, SIGN_IN_EMAIL_ERROR)).toBe(RATE_LIMIT_ERROR)
  })
})
