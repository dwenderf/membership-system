import {
  isWebAuthnSupported,
  isUserCancelledError,
  isDuplicateRegistrationError,
  isUnsupportedOriginError,
  getNextSnoozeDays,
  getNextSnoozeDate,
  isPasskeyPromptEligible,
} from '@/lib/passkeys'

describe('isWebAuthnSupported', () => {
  afterEach(() => {
    delete (global as any).window
  })

  it('returns false when window is undefined (server)', () => {
    expect(isWebAuthnSupported()).toBe(false)
  })

  it('returns false when PublicKeyCredential is absent', () => {
    ;(global as any).window = {}
    expect(isWebAuthnSupported()).toBe(false)
  })

  it('returns true when PublicKeyCredential exists', () => {
    ;(global as any).window = { PublicKeyCredential: function () {} }
    expect(isWebAuthnSupported()).toBe(true)
  })
})

describe('isUserCancelledError', () => {
  it('returns true for the Supabase ceremony-aborted code', () => {
    expect(isUserCancelledError({ code: 'ERROR_CEREMONY_ABORTED', name: 'WebAuthnError' })).toBe(true)
  })

  it('returns true for NotAllowedError directly', () => {
    expect(isUserCancelledError({ name: 'NotAllowedError' })).toBe(true)
  })

  it('returns true for AbortError directly', () => {
    expect(isUserCancelledError({ name: 'AbortError' })).toBe(true)
  })

  it('returns true when the cause is NotAllowedError', () => {
    expect(isUserCancelledError({ name: 'WebAuthnError', cause: { name: 'NotAllowedError' } })).toBe(true)
  })

  it('returns false for generic errors', () => {
    expect(isUserCancelledError(new Error('boom'))).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isUserCancelledError(null)).toBe(false)
    expect(isUserCancelledError(undefined)).toBe(false)
  })
})

describe('isDuplicateRegistrationError', () => {
  it('returns true for the Supabase previously-registered code', () => {
    expect(isDuplicateRegistrationError({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' })).toBe(true)
  })

  it('returns true for InvalidStateError directly and as cause', () => {
    expect(isDuplicateRegistrationError({ name: 'InvalidStateError' })).toBe(true)
    expect(isDuplicateRegistrationError({ name: 'WebAuthnError', cause: { name: 'InvalidStateError' } })).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isDuplicateRegistrationError(new Error('boom'))).toBe(false)
    expect(isDuplicateRegistrationError(null)).toBe(false)
  })
})

describe('isUnsupportedOriginError', () => {
  it('returns true for invalid domain / RP ID codes', () => {
    expect(isUnsupportedOriginError({ code: 'ERROR_INVALID_DOMAIN' })).toBe(true)
    expect(isUnsupportedOriginError({ code: 'ERROR_INVALID_RP_ID' })).toBe(true)
  })

  it('returns true for SecurityError directly and as cause', () => {
    expect(isUnsupportedOriginError({ name: 'SecurityError' })).toBe(true)
    expect(isUnsupportedOriginError({ name: 'WebAuthnError', cause: { name: 'SecurityError' } })).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isUnsupportedOriginError(new Error('boom'))).toBe(false)
    expect(isUnsupportedOriginError(null)).toBe(false)
  })
})

describe('getNextSnoozeDays', () => {
  it('follows the 7 -> 30 -> 90 ladder and caps at 90', () => {
    expect(getNextSnoozeDays(0)).toBe(7)
    expect(getNextSnoozeDays(1)).toBe(30)
    expect(getNextSnoozeDays(2)).toBe(90)
    expect(getNextSnoozeDays(5)).toBe(90)
  })

  it('treats negative counts as a first dismissal', () => {
    expect(getNextSnoozeDays(-1)).toBe(7)
  })
})

describe('getNextSnoozeDate', () => {
  it('returns an ISO date the right number of days out', () => {
    const from = new Date('2026-06-11T12:00:00.000Z')
    expect(getNextSnoozeDate(0, from)).toBe('2026-06-18T12:00:00.000Z')
    expect(getNextSnoozeDate(1, from)).toBe('2026-07-11T12:00:00.000Z')
    expect(getNextSnoozeDate(2, from)).toBe('2026-09-09T12:00:00.000Z')
  })
})

describe('isPasskeyPromptEligible', () => {
  const now = new Date('2026-06-11T12:00:00.000Z')

  it('is eligible with no stored prefs', () => {
    expect(isPasskeyPromptEligible(null, now)).toBe(true)
    expect(isPasskeyPromptEligible(undefined, now)).toBe(true)
    expect(isPasskeyPromptEligible({}, now)).toBe(true)
  })

  it('is not eligible when opted out', () => {
    expect(isPasskeyPromptEligible({ optedOut: true }, now)).toBe(false)
  })

  it('is not eligible while snoozed', () => {
    expect(isPasskeyPromptEligible({ snoozedUntil: '2026-06-20T00:00:00.000Z', dismissCount: 1 }, now)).toBe(false)
  })

  it('is eligible again after the snooze expires', () => {
    expect(isPasskeyPromptEligible({ snoozedUntil: '2026-06-01T00:00:00.000Z', dismissCount: 1 }, now)).toBe(true)
  })
})
