const mockCapture = jest.fn()
const mockScope = { setLevel: jest.fn(), setFingerprint: jest.fn(), setTags: jest.fn(), setContext: jest.fn() }
jest.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: unknown) => void) => fn(mockScope),
  captureMessage: (...a: unknown[]) => mockCapture(...a),
  flush: jest.fn(() => Promise.resolve(true)),
}))

const mockSend = jest.fn()
jest.mock('loops', () => {
  const actual = jest.requireActual('loops')
  return { ...actual, LoopsClient: jest.fn().mockImplementation(() => ({ sendTransactionalEmail: mockSend, sendEvent: jest.fn() })) }
})

const updates: Array<Record<string, unknown>> = []
const pending = [{ id: '11111111-2222-3333-4444-555555555555', user_id: 'u1', email_address: 'admin@example.com', subject: 's', event_type: 'admin.refund_notification', template_id: 'tpl1', email_data: { seasonName: 'X' } }]
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

describe('staged email failure reporting', () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks(); updates.length = 0
    process.env = { ...OLD, LOOPS_API_KEY: 'k', VERCEL: '1', LOOPS_EMAIL_BATCH_DELAY_MS: '0' }
  })
  afterAll(() => { process.env = OLD })
  const load = async () => {
    jest.resetModules()
    return (await import('@/lib/email/batch-sync-email')).emailProcessingManager
  }
  const missingVar = () => new APIError(400, { success: false, message: 'Missing required data variable(s): seasonName.' } as never)

  it('classifies Loops 4xx as a hard rejection and 5xx/429/network as transient', () => {
    expect(classifyLoopsError(missingVar()).kind).toBe('loops_rejected')
    expect(classifyLoopsError(new APIError(429, { success: false, message: 'rate' } as never)).kind).toBe('transient')
    expect(classifyLoopsError(new APIError(503, { success: false, message: 'down' } as never)).kind).toBe('transient')
    expect(classifyLoopsError(new Error('ECONNRESET')).kind).toBe('transient')
  })

  it('strips addresses and ids from errors', () => {
    expect(normalizeEmailError('bad a@b.com 11111111-2222-3333-4444-555555555555')).toBe('bad <email> <id>')
  })

  it('marks a 400 failed (no endless retry) and captures one grouped event without personal data', async () => {
    mockSend.mockRejectedValueOnce(missingVar())
    const res = await (await load()).processStagedEmails()
    expect(res.results?.failed).toBe(1)
    expect(updates).toContainEqual(expect.objectContaining({ status: 'failed' }))
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(['staged-email-failure', 'admin.refund_notification', 'loops_rejected', expect.stringContaining('seasonName')])
    const tags = mockScope.setTags.mock.calls[0][0]
    expect(tags).toMatchObject({ email_event_type: 'admin.refund_notification', email_template_id: 'tpl1', failure_kind: 'loops_rejected' })
    expect(JSON.stringify([mockScope.setTags.mock.calls, mockScope.setContext.mock.calls, mockCapture.mock.calls])).not.toContain('admin@example.com')
  })

  it('keeps transient failures pending and sends one per-run summary', async () => {
    mockSend.mockRejectedValueOnce(new Error('socket hang up'))
    await (await load()).processStagedEmails()
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }))
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockScope.setLevel).toHaveBeenCalledWith('warning')
    expect(mockCapture.mock.calls[0][0]).toMatch(/transient failures this run: 1/)
  })

  it('does not report successes', async () => {
    mockSend.mockResolvedValueOnce({ success: true, id: 'x' })
    await (await load()).processStagedEmails()
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
