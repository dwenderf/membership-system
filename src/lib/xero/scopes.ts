// OAuth scopes the Xero integration requests (#333).
//
// Xero retires the broad `accounting.transactions` scope on 13 September 2027.
// Its granular replacements that this app needs are:
// - accounting.invoices: invoices, online invoices and credit notes (refunds)
// - accounting.payments: payments
// We don't call bank transactions, manual journals or any Reports endpoint, so
// accounting.banktransactions, accounting.manualjournals and the report scopes
// are left out. contacts, settings and offline_access are unchanged.
//
// XERO_SCOPES in the environment wins when it is set. This default only
// applies when it is missing, so a missing env var can't silently fall back to
// the retiring broad scope.
export const DEFAULT_XERO_SCOPES: readonly string[] = [
  'accounting.invoices',
  'accounting.payments',
  'accounting.contacts',
  'accounting.settings',
  'offline_access',
]

// Broad scopes Xero is retiring. Shown by the admin debug-config route so a
// stale XERO_SCOPES value is easy to spot.
export const RETIRING_XERO_SCOPES: readonly string[] = [
  'accounting.transactions',
  'accounting.transactions.read',
  'accounting.reports.read',
]

export function getXeroScopes(): string[] {
  const configured = process.env.XERO_SCOPES?.trim()
  if (!configured) return [...DEFAULT_XERO_SCOPES]
  return configured.split(/\s+/)
}

export function getRetiringXeroScopes(scopes: string[] = getXeroScopes()): string[] {
  return scopes.filter((scope) => RETIRING_XERO_SCOPES.includes(scope))
}
