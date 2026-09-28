/**
 * #397: confirmation email to the member who signs up as an alternate.
 */

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

type QueryResult = { data: unknown; error: unknown }
const tableResults: Record<string, QueryResult> = {}
const mockInsert = jest.fn(() => Promise.resolve({ error: null }))
const mockFrom = jest.fn((table: string) => {
  if (table === 'email_logs') return { insert: mockInsert }
  type Chain = { select: jest.Mock<Chain>; eq: jest.Mock<Chain>; single: jest.Mock<Promise<QueryResult>> }
  const chain: Chain = {
    select: jest.fn((): Chain => chain),
    eq: jest.fn((): Chain => chain),
    single: jest.fn(() => Promise.resolve(tableResults[table] ?? { data: null, error: { message: 'no mock' } })),
  }
  return chain
})

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

const ORIGINAL_ENV = { ...process.env }

describe('stageAlternateRegistrationConfirmationEmail', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    process.env.LOOPS_API_KEY = 'test-loops-key'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test'
    tableResults.users = {
      data: { id: 'user-123', email: 'vinny@example.com', first_name: 'Vinny', last_name: 'Losinno' },
      error: null,
    }
    tableResults.registrations = {
      data: { name: 'NYCPHA Recreational League', alternate_price: 2500, season: { name: 'Fall/Winter 2026' } },
      error: null,
    }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  const load = async () => (await import('@/lib/email/alternate-notifications')).stageAlternateRegistrationConfirmationEmail

  it('logs a warning and skips when the template ID is not configured', async () => {
    delete process.env.LOOPS_ALTERNATE_REGISTRATION_CONFIRMATION_TEMPLATE_ID
    const stage = await load()

    await expect(stage('reg-123', 'user-123', '2026-09-19T22:49:24Z')).resolves.toBeUndefined()

    expect(mockLogSystem).toHaveBeenCalledWith(
      'alternate-registration-confirmation-template-missing',
      expect.stringContaining('LOOPS_ALTERNATE_REGISTRATION_CONFIRMATION_TEMPLATE_ID not configured'),
      { registrationId: 'reg-123', userId: 'user-123' },
      'warn'
    )
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled()
  })

  it('sends the alternate.registered email with the exact variable payload and logs it', async () => {
    process.env.LOOPS_ALTERNATE_REGISTRATION_CONFIRMATION_TEMPLATE_ID = 'tmpl-alt-reg'
    mockSendTransactionalEmail.mockResolvedValue({ success: true, id: 'loops-evt-1' })
    const stage = await load()

    await stage('reg-123', 'user-123', '2026-09-19T22:49:24Z')

    expect(mockSendTransactionalEmail).toHaveBeenCalledTimes(1)
    const call = mockSendTransactionalEmail.mock.calls[0][0]
    expect(call.transactionalId).toBe('tmpl-alt-reg')
    expect(call.email).toBe('vinny@example.com')
    // testEmailPrefix is appended to every send by EmailService (environment-specific)
    const { testEmailPrefix, ...vars } = call.dataVariables
    expect(typeof testEmailPrefix).toBe('string')
    expect(vars).toEqual({
      userName: 'Vinny Losinno',
      registrationName: 'NYCPHA Recreational League',
      seasonName: 'Fall/Winter 2026',
      categoryName: 'Alternate',
      registrationDate: '9/19/2026', // formatDate(): en-US, America/New_York
      alternatePrice: '25.00',
      dashboardUrl: 'https://example.test/user',
    })

    // Logged to email_logs through the existing service path
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-123',
      email_address: 'vinny@example.com',
      event_type: 'alternate.registered',
      template_id: 'tmpl-alt-reg',
      status: 'sent',
      triggered_by: 'user_action',
      loops_event_id: 'loops-evt-1',
    }))
  })

  it('does not throw when the user lookup fails', async () => {
    process.env.LOOPS_ALTERNATE_REGISTRATION_CONFIRMATION_TEMPLATE_ID = 'tmpl-alt-reg'
    tableResults.users = { data: null, error: { message: 'not found' } }
    const stage = await load()

    await expect(stage('reg-123', 'user-123', '2026-09-19T22:49:24Z')).resolves.toBeUndefined()
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled()
    expect(mockLogSystem).toHaveBeenCalledWith(
      'alternate-registration-confirmation-user-not-found',
      expect.any(String),
      expect.objectContaining({ userId: 'user-123' }),
      'error'
    )
  })
})
