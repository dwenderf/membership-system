import { getInstallmentDisplayStatus, planNeedsAttention } from '@/lib/payment-plan-utils'

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

  it('reports an explicit failed sync_status as failed', () => {
    expect(getInstallmentDisplayStatus(inst({ sync_status: 'failed' }), 3)).toBe('failed')
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

  it('tolerates a missing installments array', () => {
    expect(planNeedsAttention({}, 3)).toBe(false)
  })
})
