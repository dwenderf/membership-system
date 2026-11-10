/**
 * Xero OAuth scopes (#333): the default must be the granular set, not the
 * broad accounting.transactions scope Xero retires on 13 Sep 2027.
 */
import {
  DEFAULT_XERO_SCOPES,
  getRetiringXeroScopes,
  getXeroScopes,
} from '@/lib/xero/scopes'

describe('getXeroScopes', () => {
  const original = process.env.XERO_SCOPES

  afterEach(() => {
    if (original === undefined) delete process.env.XERO_SCOPES
    else process.env.XERO_SCOPES = original
  })

  it('defaults to the granular scope set when XERO_SCOPES is unset', () => {
    delete process.env.XERO_SCOPES
    expect(getXeroScopes()).toEqual([
      'accounting.invoices',
      'accounting.payments',
      'accounting.contacts',
      'accounting.settings',
      'offline_access',
    ])
  })

  it('never defaults to a retiring broad scope', () => {
    delete process.env.XERO_SCOPES
    expect(getXeroScopes()).not.toContain('accounting.transactions')
    expect(getRetiringXeroScopes()).toEqual([])
  })

  it('treats an empty or blank XERO_SCOPES as unset', () => {
    process.env.XERO_SCOPES = '   '
    expect(getXeroScopes()).toEqual([...DEFAULT_XERO_SCOPES])
  })

  it('uses XERO_SCOPES when set, tolerating extra whitespace', () => {
    process.env.XERO_SCOPES = ' accounting.invoices  accounting.contacts\toffline_access '
    expect(getXeroScopes()).toEqual(['accounting.invoices', 'accounting.contacts', 'offline_access'])
  })

  it('returns a fresh array so callers cannot mutate the default', () => {
    delete process.env.XERO_SCOPES
    getXeroScopes().push('accounting.transactions')
    expect(getXeroScopes()).not.toContain('accounting.transactions')
  })
})

describe('getRetiringXeroScopes', () => {
  it('flags the broad scopes still configured', () => {
    expect(
      getRetiringXeroScopes([
        'accounting.transactions',
        'accounting.contacts',
        'accounting.settings',
        'offline_access',
      ])
    ).toEqual(['accounting.transactions'])
  })

  it('flags the read-only and reports broad scopes too', () => {
    expect(
      getRetiringXeroScopes(['accounting.transactions.read', 'accounting.reports.read', 'accounting.invoices'])
    ).toEqual(['accounting.transactions.read', 'accounting.reports.read'])
  })
})
