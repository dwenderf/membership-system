/**
 * "The original invoice for this payment" must never be a stale cart. Old carts (staged, or abandoned by
 * the housekeeping sweep) can share a payment_id with the real invoice, and a lookup that takes any ACCREC
 * invoice for the payment can match one of them (with .single() it errors on the duplicates instead).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { UNPROMOTED_INVOICE_STATUSES_FILTER } from '@/lib/xero/invoice-status'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

describe('UNPROMOTED_INVOICE_STATUSES_FILTER', () => {
  it('lists exactly the staged and abandoned states, in PostgREST list syntax', () => {
    expect(UNPROMOTED_INVOICE_STATUSES_FILTER).toBe('(staged,abandoned)')
  })
})

describe.each([
  ['src/lib/xero/staging.ts', 2],
  ['src/lib/xero/batch-sync-xero.ts', 1],
])('%s', (file, expected) => {
  const source = read(file)

  it('excludes unpromoted invoices wherever it looks up the original ACCREC invoice by payment_id', () => {
    // every `.eq('payment_id', X).eq('invoice_type', 'ACCREC')` lookup, with what follows it
    const lookups = [...source.matchAll(/\.eq\('payment_id', [\w.]+\)\s*\.eq\('invoice_type', 'ACCREC'\)([^\n]*\n[^\n]*)/g)]
    expect(lookups).toHaveLength(expected)
    for (const [, following] of lookups) {
      expect(following).toContain(".not('sync_status', 'in', UNPROMOTED_INVOICE_STATUSES_FILTER)")
    }
  })
})

describe('admin user page payment plan status', () => {
  it('does not take a staged or abandoned invoice as the original plan invoice', () => {
    const source = read('src/app/admin/reports/users/[id]/page.tsx')
    expect(source).toMatch(/inv\.is_payment_plan &&\s*inv\.sync_status !== 'staged' && inv\.sync_status !== 'abandoned'/)
  })
})
