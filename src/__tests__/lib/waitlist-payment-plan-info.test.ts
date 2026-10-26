jest.mock('@/lib/supabase/server', () => ({ createAdminClient: jest.fn() }))
jest.mock('@/lib/email/service', () => ({ emailService: {} }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logSystem: jest.fn() } }))

import { buildWaitlistPaymentPlanInfo } from '@/lib/email/waitlist-notifications'

describe('buildWaitlistPaymentPlanInfo (#442)', () => {
  const chargedAt = new Date('2026-10-26T16:00:00Z')

  it('describes the plan, quoting the exact remaining balance', () => {
    expect(buildWaitlistPaymentPlanInfo(2513, { isPaymentPlan: true, totalAmount: 10050, paymentPlanFallback: false }, chargedAt))
      .toBe("You're on a payment plan for $100.50: today's charge of $25.13 is payment 1 of 4. The remaining $75.37 will be charged to your saved card in 3 payments, every 30 days starting 11/25/2026.")
  })

  it('explains the full charge when the member chose a plan but was no longer eligible', () => {
    expect(buildWaitlistPaymentPlanInfo(10000, { isPaymentPlan: false, totalAmount: 10000, paymentPlanFallback: true }, chargedAt))
      .toBe('You chose a payment plan when you joined the waitlist, but your account is no longer set up for payment plans, so the full $100.00 was charged today. If you have questions, please contact us.')
  })

  it('is blank when the member did not choose a plan', () => {
    expect(buildWaitlistPaymentPlanInfo(10000, undefined, chargedAt)).toBe('')
    expect(buildWaitlistPaymentPlanInfo(10000, { isPaymentPlan: false, totalAmount: 10000, paymentPlanFallback: false }, chargedAt)).toBe('')
  })
})
