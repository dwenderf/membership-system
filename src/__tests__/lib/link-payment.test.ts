/**
 * A new purchase's payment must be linked only to the Xero invoice created for that checkout, not to
 * every staged invoice the member has (which stamped old abandoned carts with unrelated payments).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { linkPaymentToStagingInvoice } from '@/lib/xero/link-payment'

function fakeClient() {
  const filters: Array<[string, ...unknown[]]> = []
  const updates: Array<Record<string, unknown>> = []
  const q: Record<string, unknown> = {}
  q.update = (values: Record<string, unknown>) => { updates.push(values); return q }
  for (const m of ['eq', 'is']) q[m] = (...args: unknown[]) => { filters.push([m, ...args]); return q }
  const client = { from: (table: string) => { filters.push(['from', table]); return q } }
  return { client: client as never, filters, updates }
}

describe('linkPaymentToStagingInvoice', () => {
  it('updates exactly the given invoice, only while it is still staged and unlinked', () => {
    const { client, filters, updates } = fakeClient()

    linkPaymentToStagingInvoice(client, 'invoice-1', 'payment-1')

    expect(updates).toEqual([{ payment_id: 'payment-1' }])
    expect(filters).toEqual([
      ['from', 'xero_invoices'],
      ['eq', 'id', 'invoice-1'],
      ['eq', 'sync_status', 'staged'],
      ['is', 'payment_id', null],
    ])
  })

  it('never filters by user, which is what mislinked old carts', () => {
    const { client, filters } = fakeClient()
    linkPaymentToStagingInvoice(client, 'invoice-1', 'payment-1')
    expect(JSON.stringify(filters)).not.toContain('user_id')
  })
})

describe('payment-intent routes', () => {
  const routes = [
    'src/app/api/create-registration-payment-intent/route.ts',
    'src/app/api/create-membership-payment-intent/route.ts',
  ]

  it.each(routes)('%s does not link a payment to all of a user\'s staged invoices', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    // .update({ payment_id: ... }) followed by a user-wide filter on staging_metadata
    expect(source).not.toMatch(/\.update\(\{\s*payment_id[^)]*\)\s*\.eq\('staging_metadata->>user_id'/)
    expect(source).toContain('linkPaymentToStagingInvoice')
  })
})
