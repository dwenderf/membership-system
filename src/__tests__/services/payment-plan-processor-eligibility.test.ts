/**
 * Retry eligibility in processDuePayments: the cron respects the attempt cap and the
 * retry interval (with a small grace window for run-to-run drift), while an admin
 * "Run Payments" (includeExhausted) retries everything that is due.
 */

const mockDuePayments: Array<Record<string, unknown>> = []
const mockProcess = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {}
    const result = { data: mockDuePayments, error: null }
    const single = { data: null, error: null }
    chain.select = () => chain
    chain.eq = () => chain
    chain.lte = () => Promise.resolve(result)
    chain.single = () => Promise.resolve(single)
    chain.from = () => chain
    return { from: () => chain }
  }
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logBatchProcessing: jest.fn(),
    logPaymentProcessing: jest.fn(),
    reportWarningToSentry: jest.fn()
  }
}))
jest.mock('@/lib/services/payment-plan-service', () => ({
  PaymentPlanService: { processPaymentPlanTransaction: (...a: unknown[]) => mockProcess(...a) }
}))
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: jest.fn() } }))
jest.mock('@/lib/email/service', () => ({ EMAIL_EVENTS: {} }))
jest.mock('@/lib/email/admin-notifications', () => ({
  stageAdminPaymentPlanFailureNotification: jest.fn()
}))

import { processDuePayments } from '@/lib/services/payment-plan-processor'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString()

const payment = (id: string, attempt_count: number, last_attempt_at: string | null) => ({
  id,
  attempt_count,
  last_attempt_at,
  installment_number: 2,
  amount_paid: 2500,
  planned_payment_date: '2026-10-16',
  xero_invoice: { id: 'inv', user_registrations: [{ user_id: 'u1', registration: null }] }
})

describe('processDuePayments retry eligibility', () => {
  beforeEach(() => {
    mockDuePayments.length = 0
    mockProcess.mockReset()
    mockProcess.mockResolvedValue({ success: true, paymentId: 'p' })
  })

  const attempted = () => mockProcess.mock.calls.map(c => c[0]).sort()

  it('skips payments that used up their attempts', async () => {
    mockDuePayments.push(payment('exhausted', 3, hoursAgo(48)))
    await processDuePayments('2026-10-18')
    expect(attempted()).toEqual([])
  })

  it('retries when slightly under 24h has passed (cron drift)', async () => {
    mockDuePayments.push(payment('drift', 1, hoursAgo(23.99)))
    await processDuePayments('2026-10-18')
    expect(attempted()).toEqual(['drift'])
  })

  it('waits when the last attempt was recent', async () => {
    mockDuePayments.push(payment('recent', 1, hoursAgo(5)))
    await processDuePayments('2026-10-18')
    expect(attempted()).toEqual([])
  })

  it('includeExhausted retries exhausted and recent payments too', async () => {
    mockDuePayments.push(payment('exhausted', 3, hoursAgo(48)), payment('recent', 1, hoursAgo(5)))
    await processDuePayments('2026-10-18', { includeExhausted: true })
    expect(attempted()).toEqual(['exhausted', 'recent'])
  })
})
