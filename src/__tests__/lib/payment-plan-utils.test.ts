import { getInstallmentDisplayStatus, isStartedPlan, planNeedsAttention } from '@/lib/payment-plan-utils'

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

describe('isStartedPlan', () => {
  it('rejects an abandoned checkout: nothing paid and every installment still staged', () => {
    const installments = [1, 2, 3, 4].map(n => ({ ...inst({ sync_status: 'staged' }), installment_number: n }))
    expect(isStartedPlan({ installments_paid: 0, installments })).toBe(false)
  })

  it('accepts a plan with a paid installment', () => {
    expect(isStartedPlan({ installments_paid: 1, installments: [inst({ sync_status: 'synced' }), inst({ sync_status: 'staged' })] })).toBe(true)
  })

  it('accepts a plan whose remaining installments are planned', () => {
    expect(isStartedPlan({ installments_paid: 0, installments: [inst()] })).toBe(true)
  })

  it('tolerates a missing installments array', () => {
    expect(isStartedPlan({ installments_paid: 0, installments: undefined as never })).toBe(false)
  })
})
