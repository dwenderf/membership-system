const mockStageEmail = jest.fn(() => Promise.resolve(true))
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: (...a: unknown[]) => mockStageEmail(...(a as [])) } }))
jest.mock('@/lib/email/admin-notifications', () => ({ stageAdminRefundNotification: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/email/captain-notifications', () => ({ stageCaptainRosterChangeNotification: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/run-after-response', () => ({ runAfterResponse: jest.fn() }))
const mockResolve = jest.fn()
jest.mock('@/lib/email/refund-context', () => ({ resolveRefundEmailContext: (...a: unknown[]) => mockResolve(...a) }))
const mockWarn = jest.fn()
jest.mock('@/lib/logging/logger', () => ({ logger: { logSystem: jest.fn(), reportWarningToSentry: (...a: unknown[]) => mockWarn(...a) } }))

const rows: Record<string, unknown> = {
  users: { first_name: 'A', last_name: 'B', email: 'member@example.com' },
  refunds: { amount: 5000, reason: 'r', created_at: '2026-10-13T21:10:00Z' },
  payments: { final_amount: 5000, completed_at: '2026-10-13T20:00:00Z', created_at: '2026-10-13T20:00:00Z' },
  xero_invoices: { invoice_number: 'INV-1' },
}
jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      const c: Record<string, jest.Mock> = {}
      c.select = jest.fn(() => c); c.eq = jest.fn(() => c)
      c.single = jest.fn(() => Promise.resolve({ data: rows[t] ?? null, error: rows[t] ? null : { message: 'none' } }))
      return c
    },
  }),
}))

import { stageRefundNotificationEmail, REFUND_FALLBACK_REGISTRATION_NAME, REFUND_FALLBACK_SEASON_NAME } from '@/lib/email/refund-notification'

describe('member refund email registration/season', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.LOOPS_REFUND_TEMPLATE_ID = 'tpl-refund' })
  const data = () => (mockStageEmail.mock.calls[0] as unknown as [{ email_data: Record<string, unknown> }])[0].email_data

  it('includes the resolved names', async () => {
    mockResolve.mockResolvedValueOnce({ registrationName: 'Rec League', seasonName: 'Fall/Winter 2026', source: 'alternate' })
    await stageRefundNotificationEmail('r1', 'u1', 'p1')
    expect(data()).toMatchObject({ registrationName: 'Rec League', seasonName: 'Fall/Winter 2026' })
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('links the dashboard button to /user (there is no /user/dashboard route)', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.test'
    mockResolve.mockResolvedValueOnce(null)
    await stageRefundNotificationEmail('r1', 'u1', 'p1')
    expect(data().dashboardUrl).toBe('https://site.test/user')
  })

  it('sends neutral non-empty fallbacks and warns when the item cannot be resolved', async () => {
    mockResolve.mockResolvedValueOnce(null)
    await stageRefundNotificationEmail('r1', 'u1', 'p1')
    expect(mockStageEmail).toHaveBeenCalledTimes(1)
    expect(data()).toMatchObject({ registrationName: REFUND_FALLBACK_REGISTRATION_NAME, seasonName: REFUND_FALLBACK_SEASON_NAME })
    expect(REFUND_FALLBACK_REGISTRATION_NAME.trim()).not.toBe('')
    expect(REFUND_FALLBACK_SEASON_NAME.trim()).not.toBe('')
    expect(mockWarn).toHaveBeenCalledWith('system', 'refund-email-context-missing', expect.any(String), { refundId: 'r1', paymentId: 'p1' })
  })
})
