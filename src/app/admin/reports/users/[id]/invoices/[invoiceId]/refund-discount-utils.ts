/** Warning shown in the refund dialog when the payment already used one or more discount codes (#454). */
export function appliedCodesWarningText(codes: { code: string }[] | undefined | null): string | null {
  if (!codes || codes.length === 0) return null
  const names = codes.map(c => c.code).join(', ')
  return codes.length === 1
    ? `This registration already used discount code ${names}. A different code can be stacked (your call), but ${names} can't be applied again. A stacked code is calculated on the full price and the total discount is capped at 100%.`
    : `This registration already used discount codes ${names}. A different code can be stacked (your call), but these can't be applied again. A stacked code is calculated on the full price and the total discount is capped at 100%.`
}

/** Returns the already-applied code matching `code` (case/whitespace-insensitive), if any. */
export function findAppliedCode<T extends { code: string }>(code: string, applied: T[] | undefined | null): T | undefined {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return undefined
  return (applied || []).find(c => c.code.trim().toUpperCase() === normalized)
}

export function reusedCodeValidation(code: string) {
  return {
    isValid: false as const,
    alreadyApplied: true,
    error: `${code} was already applied to this payment, so it can't be applied again as a refund.`
  }
}

/**
 * Whether Preview Refund may be submitted for a discount-code refund (#454). Disabled while the
 * code is empty, pending (debounce or request in flight), invalid, already applied, or the
 * original invoice is missing.
 */
export function canSubmitDiscountRefund(args: {
  validation: { isValid: boolean; alreadyApplied?: boolean; missingOriginalInvoice?: boolean } | null | undefined
  isValidating: boolean
  code: string
  hasValidReason: boolean
}): boolean {
  const { validation, isValidating, code, hasValidReason } = args
  if (!hasValidReason || isValidating || !code.trim() || !validation) return false
  if (validation.alreadyApplied || validation.missingOriginalInvoice) return false
  return validation.isValid === true
}
