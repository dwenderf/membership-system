import { appliedCodesWarningText, findAppliedCode, reusedCodeValidation, canSubmitDiscountRefund } from '@/app/admin/reports/users/[id]/invoices/[invoiceId]/refund-discount-utils'

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

  describe('canSubmitDiscountRefund (Preview Refund button)', () => {
    const base = { isValidating: false, code: 'EXTRA25', hasValidReason: true }
    it('is disabled while the already-applied rejection is showing', () => {
      expect(canSubmitDiscountRefund({ ...base, validation: reusedCodeValidation('729BOARD50OFF') })).toBe(false)
      expect(canSubmitDiscountRefund({ ...base, validation: { isValid: true, alreadyApplied: true } })).toBe(false)
    })
    it('is disabled for invalid or pending codes', () => {
      expect(canSubmitDiscountRefund({ ...base, validation: { isValid: false } })).toBe(false)
      expect(canSubmitDiscountRefund({ ...base, validation: null })).toBe(false)
      expect(canSubmitDiscountRefund({ ...base, isValidating: true, validation: { isValid: true } })).toBe(false)
      expect(canSubmitDiscountRefund({ ...base, code: '  ', validation: { isValid: true } })).toBe(false)
    })
    it('is disabled without a reason', () => {
      expect(canSubmitDiscountRefund({ ...base, hasValidReason: false, validation: { isValid: true } })).toBe(false)
    })
    it('is enabled for a valid, settled code with a reason', () => {
      expect(canSubmitDiscountRefund({ ...base, validation: { isValid: true } })).toBe(true)
    })
  })
  it('#454 (b): keeps Preview Refund disabled when the original invoice is missing', () => {
    expect(canSubmitDiscountRefund({
      validation: { isValid: false, missingOriginalInvoice: true },
      isValidating: false, code: 'NEWCODE', hasValidReason: true
    })).toBe(false)
    // defensive: even if a response were marked valid, a missing invoice still blocks
    expect(canSubmitDiscountRefund({
      validation: { isValid: true, missingOriginalInvoice: true },
      isValidating: false, code: 'NEWCODE', hasValidReason: true
    })).toBe(false)
  })
})
