/**
 * Regression for #395: email_logs insert must be awaited and its { error }
 * result checked. A log failure must be reported loudly but must not fail a
 * send that already succeeded.
 */

process.env.LOOPS_API_KEY = 'test-loops-key'

const mockInsert = jest.fn()
const mockFrom = jest.fn(() => ({ insert: mockInsert }))

jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: mockFrom }),
  createClient: jest.fn(),
}))

const mockLogSystem = jest.fn()
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logSystem: (...args: unknown[]) => mockLogSystem(...args),
  },
}))

const mockSendTransactionalEmail = jest.fn()
jest.mock('loops', () => {
  const actual = jest.requireActual('loops')
  return {
    ...actual,
    LoopsClient: jest.fn().mockImplementation(() => ({
      sendTransactionalEmail: mockSendTransactionalEmail,
      sendEvent: jest.fn(),
    })),
  }
})

import { emailService } from '@/lib/email/service'

describe('emailService email_logs insert (#395)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('awaits the email_logs insert and logs when Supabase returns an error', async () => {
    mockSendTransactionalEmail.mockResolvedValue({ success: true, id: 'loops-1' })
    mockInsert.mockResolvedValue({
      error: { message: 'insert failed', code: '23505' },
      data: null,
    })

    const result = await emailService.sendEmailImmediately({
      userId: 'user-1',
      email: 'player@example.com',
      eventType: 'admin.new_registration',
      subject: 'New registration',
      templateId: 'tmpl-1',
      data: { foo: 'bar' },
    })

    // Send still succeeds — logging failure must not flip success to false
    expect(result.success).toBe(true)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockLogSystem).toHaveBeenCalledWith(
      'email-log-to-database-failed',
      'Failed to log email to database',
      expect.objectContaining({
        userId: 'user-1',
        email: 'player@example.com',
        error: 'insert failed',
        code: '23505',
      }),
      'error'
    )
  })

  it('does not report a log failure when the insert succeeds', async () => {
    mockSendTransactionalEmail.mockResolvedValue({ success: true, id: 'loops-2' })
    mockInsert.mockResolvedValue({ error: null, data: [{ id: 'log-1' }] })

    const result = await emailService.sendEmailImmediately({
      userId: 'user-2',
      email: 'player2@example.com',
      eventType: 'admin.new_registration',
      subject: 'New registration',
      templateId: 'tmpl-1',
    })

    expect(result.success).toBe(true)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockLogSystem).not.toHaveBeenCalledWith(
      'email-log-to-database-failed',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})
