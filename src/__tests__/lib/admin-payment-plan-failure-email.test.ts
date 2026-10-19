/**
 * Admin payment plan failure email sends the member's name as `userName`
 * (renamed from `playerName`); the Loops template reads `userName`.
 */
process.env.LOOPS_API_KEY = 'test-loops-key'
process.env.LOOPS_ADMIN_PAYMENT_PLAN_FAILURE_TEMPLATE_ID = 'tmpl-pp-failure'

const mockInsert = jest.fn(() => Promise.resolve({ error: null }))
jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => ({ insert: mockInsert }) }),
  createClient: jest.fn(),
}))
jest.mock('@/lib/logging/logger', () => ({ logger: { logSystem: jest.fn() } }))

const mockSendTransactionalEmail = jest.fn()
jest.mock('loops', () => {
  const actual = jest.requireActual('loops')
  return {
    ...actual,
    LoopsClient: jest.fn().mockImplementation(() => ({ sendTransactionalEmail: mockSendTransactionalEmail, sendEvent: jest.fn() })),
  }
})

import { emailService } from '@/lib/email/service'

it('sends userName (not playerName) and uses it in the subject', async () => {
  mockSendTransactionalEmail.mockResolvedValue({ success: true, id: 'loops-1' })

  await emailService.sendAdminPaymentPlanFailureNotification({
    adminUserId: 'admin-1',
    adminEmail: 'admin@example.com',
    adminName: 'Admin One',
    userName: 'Member Two',
    registrationName: 'Rec League',
    seasonName: 'Fall/Winter 2026',
    installmentNumber: 2,
    totalInstallments: 4,
    installmentAmount: '$25.00',
    failureReason: 'card_declined',
    attemptSummary: 'Attempt 1 of 3 failed.',
    userUrl: 'https://site.test/admin/reports/users/u-2',
    scheduledDate: '10/16/2026',
    amountPaid: '$162.50',
    remainingBalance: '$487.50',
  })

  const vars = mockSendTransactionalEmail.mock.calls[0][0].dataVariables
  expect(mockSendTransactionalEmail.mock.calls[0][0].transactionalId).toBe('tmpl-pp-failure')
  expect(vars.userName).toBe('Member Two')
  expect(vars).not.toHaveProperty('playerName')
  expect(vars).toMatchObject({ scheduledDate: '10/16/2026', amountPaid: '$162.50', remainingBalance: '$487.50' })
  const logged = (mockInsert.mock.calls[0] as unknown as [{ subject: string }])[0]
  expect(logged.subject).toContain('Payment Plan Failure: Member Two – Rec League')
})
