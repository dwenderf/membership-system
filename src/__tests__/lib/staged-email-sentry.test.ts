// Record EVERYTHING that could reach Sentry, so the PII test can scan it all.
const sentryCalls: Array<{ fn: string; args: unknown[] }> = []
const rec = (fn: string) => jest.fn((...args: unknown[]) => { sentryCalls.push({ fn, args }) })
const mockScope = {
  setLevel: rec('scope.setLevel'), setFingerprint: rec('scope.setFingerprint'), setTags: rec('scope.setTags'),
  setTag: rec('scope.setTag'), setContext: rec('scope.setContext'), setExtra: rec('scope.setExtra'),
  setExtras: rec('scope.setExtras'), setUser: rec('scope.setUser'), addBreadcrumb: rec('scope.addBreadcrumb'),
}
const mockCapture = rec('captureMessage')
jest.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: unknown) => void) => fn(mockScope),
  captureMessage: (...a: unknown[]) => mockCapture(...a),
  captureException: (...a: unknown[]) => sentryCalls.push({ fn: 'captureException', args: a }),
  addBreadcrumb: (...a: unknown[]) => sentryCalls.push({ fn: 'addBreadcrumb', args: a }),
  setContext: (...a: unknown[]) => sentryCalls.push({ fn: 'setContext', args: a }),
  setExtra: (...a: unknown[]) => sentryCalls.push({ fn: 'setExtra', args: a }),
  setTag: (...a: unknown[]) => sentryCalls.push({ fn: 'setTag', args: a }),
  setUser: (...a: unknown[]) => sentryCalls.push({ fn: 'setUser', args: a }),
  flush: jest.fn(() => Promise.resolve(true)),
}))

const mockSend = jest.fn()
jest.mock('loops', () => {
  const actual = jest.requireActual('loops')
  return { ...actual, LoopsClient: jest.fn().mockImplementation(() => ({ sendTransactionalEmail: mockSend, sendEvent: jest.fn() })) }
})

const TEST_EMAIL = 'pii-canary@example.com'
const updates: Array<Record<string, unknown>> = []
const pending = [{ id: '11111111-2222-3333-4444-555555555555', user_id: 'u1', email_address: TEST_EMAIL, subject: 's', event_type: 'admin.refund_notification', template_id: 'tpl1', email_data: { seasonName: 'X' } }]
const mockFrom = jest.fn(() => {
  const chain: Record<string, jest.Mock> = {}
  chain.select = jest.fn(() => chain)
  chain.eq = jest.fn(() => chain)
  chain.order = jest.fn(() => chain)
  chain.limit = jest.fn(() => Promise.resolve({ data: pending, error: null }))
  chain.update = jest.fn((u: Record<string, unknown>) => { updates.push(u); return { eq: jest.fn(() => Promise.resolve({ error: null })) } })
  return chain
})
jest.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: mockFrom }) }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logSystem: jest.fn(), logBatchProcessing: jest.fn(), logPaymentProcessing: jest.fn() } }))

import { APIError } from 'loops'
import { classifyLoopsError, normalizeEmailError } from '@/lib/email/staged-email-sentry'

const apiErr = (status: number, message: string) => {
  const e = new APIError(status, { success: false, message } as never)
  e.message = `${status} - ${message}`
  return e
}

describe('staged email failure reporting', () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks(); updates.length = 0; sentryCalls.length = 0
    process.env = { ...OLD, LOOPS_API_KEY: 'k', VERCEL: '1', LOOPS_EMAIL_BATCH_DELAY_MS: '0', NEXT_PUBLIC_SENTRY_DSN: 'https://k@o0.ingest.sentry.io/0' }
  })
  afterAll(() => { process.env = OLD })
  const load = async () => {
    jest.resetModules()
    return (await import('@/lib/email/batch-sync-email')).emailProcessingManager
  }
  const missingVar = () => apiErr(400, `Missing required data variable(s): seasonName. Recipient ${TEST_EMAIL}`)

  it('classifies per-email data errors as permanent, setup errors as config, the rest as transient', () => {
    expect(classifyLoopsError(missingVar()).kind).toBe('loops_rejected')
    expect(classifyLoopsError(apiErr(422, 'Invalid email address')).kind).toBe('loops_rejected')
    for (const s of [401, 403, 404, 408]) expect(classifyLoopsError(apiErr(s, 'x')).kind).toBe('loops_config')
    expect(classifyLoopsError(apiErr(400, 'Transactional email is not published')).kind).toBe('loops_config')
    expect(classifyLoopsError(apiErr(400, 'Sending domain not verified')).kind).toBe('loops_config')
    expect(classifyLoopsError(apiErr(429, 'rate')).kind).toBe('transient')
    expect(classifyLoopsError(apiErr(503, 'down')).kind).toBe('transient')
    expect(classifyLoopsError(new Error('ECONNRESET')).kind).toBe('transient')
  })

  it('strips addresses and ids from errors', () => {
    expect(normalizeEmailError('bad a@b.com 11111111-2222-3333-4444-555555555555')).toBe('bad <email> <id>')
  })

  it('marks a data error failed and captures one grouped event', async () => {
    mockSend.mockRejectedValueOnce(missingVar())
    const res = await (await load()).processStagedEmails()
    expect(res.results?.failed).toBe(1)
    expect(updates).toContainEqual(expect.objectContaining({ status: 'failed' }))
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(['staged-email-failure', 'admin.refund_notification', 'loops_rejected', expect.stringContaining('seasonName')])
    expect(mockScope.setTags.mock.calls[0][0]).toMatchObject({ email_event_type: 'admin.refund_notification', email_template_id: 'tpl1', failure_kind: 'loops_rejected' })
  })

  it.each([
    ['data error', () => missingVar()],
    ['setup error', () => apiErr(401, `Invalid API key for ${TEST_EMAIL}`)],
    ['transient error', () => new Error(`socket hang up sending to ${TEST_EMAIL}`)],
  ])('never sends the recipient address to Sentry (%s)', async (_label, makeErr) => {
    mockSend.mockRejectedValueOnce(makeErr())
    await (await load()).processStagedEmails()
    expect(sentryCalls.length).toBeGreaterThan(0)
    const payload = JSON.stringify(sentryCalls, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v))
    expect(payload).not.toContain(TEST_EMAIL)
  })

  it('keeps setup errors pending and alerts once, throttled across cron runs', async () => {
    const mgr = await load()
    mockSend.mockRejectedValueOnce(apiErr(401, 'Invalid API key'))
    await mgr.processStagedEmails()
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }))
    expect(updates).not.toContainEqual(expect.objectContaining({ status: 'failed' }))
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(['staged-email-loops-config', '401'])
    mockSend.mockRejectedValueOnce(apiErr(401, 'Invalid API key'))
    await mgr.processStagedEmails()
    expect(mockCapture).toHaveBeenCalledTimes(1)
  })

  it('alerts again for config errors after the throttle window', async () => {
    const now = jest.spyOn(Date, 'now')
    const mgr = await load()
    const { ALERT_THROTTLE_MS } = await import('@/lib/email/staged-email-sentry')
    now.mockReturnValue(1_000_000)
    mockSend.mockRejectedValueOnce(apiErr(404, 'Transactional not found'))
    await mgr.processStagedEmails()
    now.mockReturnValue(1_000_000 + ALERT_THROTTLE_MS + 1)
    mockSend.mockRejectedValueOnce(apiErr(404, 'Transactional not found'))
    await mgr.processStagedEmails()
    expect(mockCapture).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('keeps transient failures pending with one throttled summary', async () => {
    const mgr = await load()
    mockSend.mockRejectedValueOnce(new Error('socket hang up'))
    await mgr.processStagedEmails()
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }))
    expect(mockScope.setLevel).toHaveBeenCalledWith('warning')
    expect(mockCapture.mock.calls[0][0]).toMatch(/transient failures this run: 1/)
    mockSend.mockRejectedValueOnce(new Error('socket hang up'))
    await mgr.processStagedEmails()
    expect(mockCapture).toHaveBeenCalledTimes(1)
  })

  it('does not report when the Sentry DSN is unset', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    mockSend.mockRejectedValueOnce(missingVar())
    await (await load()).processStagedEmails()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not report successes', async () => {
    mockSend.mockResolvedValueOnce({ success: true, id: 'x' })
    await (await load()).processStagedEmails()
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
