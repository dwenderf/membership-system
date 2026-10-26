import { appliedCodesWarningText, findAppliedCode, reusedCodeValidation } from '@/app/admin/reports/users/[id]/invoices/[invoiceId]/refund-discount-utils'

describe('refund discount utils (#454)', () => {
  it('returns no warning when no code was used', () => {
    expect(appliedCodesWarningText([])).toBeNull()
    expect(appliedCodesWarningText(undefined)).toBeNull()
  })

  it('names the already-used code in the warning', () => {
    expect(appliedCodesWarningText([{ code: '729BOARD50OFF' }])).toContain('already used discount code 729BOARD50OFF')
  })

  it('matches a reused code case/whitespace-insensitively', () => {
    const applied = [{ id: 'c1', code: '729BOARD50OFF' }]
    expect(findAppliedCode(' 729board50off ', applied)?.id).toBe('c1')
    expect(findAppliedCode('PRIDE100', applied)).toBeUndefined()
    expect(findAppliedCode('', applied)).toBeUndefined()
  })

  it('builds an invalid result explaining why', () => {
    const r = reusedCodeValidation('729BOARD50OFF')
    expect(r.isValid).toBe(false)
    expect(r.error).toMatch(/already applied to this payment/)
  })
})
