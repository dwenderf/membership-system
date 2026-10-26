import {
  getInstallmentDisplayStatus,
  planNeedsAttention,
  isUserPaymentPlanEligible,
  calculateFirstInstallmentAmount,
  buildPaymentPlanIntentMetadata,
  calculateNextInstallmentDate
} from '@/lib/payment-plan-utils'

const inst = (over: Partial<{ sync_status: string; attempt_count: number; failure_reason: string | null }> = {}) => ({
  id: 'i1',
  installment_number: 2,
  amount: 2500,
  planned_payment_date: '2026-10-16',
  sync_status: 'planned',
  attempt_count: 0,
  failure_reason: null,
  ...over
})

describe('getInstallmentDisplayStatus', () => {
  it('treats synced/pending/processing as paid', () => {
    for (const sync_status of ['synced', 'pending', 'processing']) {
      expect(getInstallmentDisplayStatus(inst({ sync_status }), 3)).toBe('paid')
    }
  })

  it('treats an untouched planned installment as scheduled', () => {
    expect(getInstallmentDisplayStatus(inst(), 3)).toBe('scheduled')
  })

  it('flags a planned installment with a recorded failure as failing while attempts remain', () => {
    expect(
      getInstallmentDisplayStatus(inst({ attempt_count: 2, failure_reason: 'Your card was declined.' }), 3)
    ).toBe('failing')
  })

  it('flags it as exhausted once attempts reach the maximum', () => {
    expect(
      getInstallmentDisplayStatus(inst({ attempt_count: 3, failure_reason: 'Your card was declined.' }), 3)
    ).toBe('exhausted')
  })

  it('reports sync_status failed as an accounting sync failure, not a payment failure', () => {
    expect(getInstallmentDisplayStatus(inst({ sync_status: 'failed' }), 3)).toBe('sync_failed')
  })
})

describe('planNeedsAttention', () => {
  it('is false for a healthy plan', () => {
    expect(planNeedsAttention({ installments: [inst({ sync_status: 'synced' }), inst()] }, 3)).toBe(false)
  })

  it('is true when any installment is failing', () => {
    expect(
      planNeedsAttention({ installments: [inst({ attempt_count: 1, failure_reason: 'declined' })] }, 3)
    ).toBe(true)
  })

  it('is false when only the Xero sync failed (the member may have paid)', () => {
    expect(planNeedsAttention({ installments: [inst({ sync_status: 'failed', attempt_count: 1 })] }, 3)).toBe(false)
  })

  it('tolerates a missing installments array', () => {
    expect(planNeedsAttention({}, 3)).toBe(false)
  })
})

describe('shared checkout/waitlist plan helpers (#442)', () => {
  it('isUserPaymentPlanEligible needs both the admin flag and a saved card', () => {
    expect(isUserPaymentPlanEligible({ payment_plan_enabled: true, stripe_payment_method_id: 'pm_1' })).toBe(true)
    expect(isUserPaymentPlanEligible({ payment_plan_enabled: false, stripe_payment_method_id: 'pm_1' })).toBe(false)
    expect(isUserPaymentPlanEligible({ payment_plan_enabled: true, stripe_payment_method_id: null })).toBe(false)
    expect(isUserPaymentPlanEligible(null)).toBe(false)
  })

  it('first installment is a rounded quarter; metadata matches what the webhook reads', () => {
    expect(calculateFirstInstallmentAmount(10000)).toBe(2500)
    expect(calculateFirstInstallmentAmount(10050)).toBe(2513)
    expect(buildPaymentPlanIntentMetadata(10050)).toEqual({
      isPaymentPlan: 'true',
      paymentPlanTotalAmount: '10050',
      paymentPlanInstallmentAmount: '2513'
    })
  })

  it('next installment is 30 days after the first', () => {
    const next = calculateNextInstallmentDate(new Date('2026-10-26T12:00:00Z'))
    expect(next.toISOString()).toBe('2026-11-25T12:00:00.000Z')
  })
})
