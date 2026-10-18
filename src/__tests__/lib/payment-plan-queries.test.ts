/**
 * fetchStartedPlanSummaries hides plans whose checkout never completed (DRAFT invoices)
 * without relying on whether any installment has been paid.
 */
import { fetchStartedPlanSummaries, fetchAbandonedPlanInvoiceIds } from '@/lib/payment-plan-queries'

const plan = (invoice_id: string) => ({
  invoice_id, contact_id: 'u1', status: 'active', installments_paid: 0, installments: []
})

function mockClient(opts: { plans: unknown[]; draftIds: string[]; summaryError?: string }) {
  const draftQueries: Array<Record<string, unknown>> = []
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      const chain = () => q
      if (table === 'payment_plan_summary') {
        for (const m of ['select', 'eq', 'in']) q[m] = chain
        q.overrideTypes = async () => ({
          data: opts.summaryError ? null : opts.plans,
          error: opts.summaryError ? { message: opts.summaryError } : null
        })
      } else {
        const filters: Record<string, unknown> = {}
        for (const m of ['select', 'order', 'range']) q[m] = chain
        q.eq = (k: string, v: unknown) => { filters[k] = v; return q }
        q.then = (res: (v: unknown) => unknown) => {
          draftQueries.push(filters)
          return Promise.resolve({ data: opts.draftIds.map(id => ({ id })), error: null }).then(res)
        }
      }
      return q
    }
  }
  return { client: client as never, draftQueries }
}

describe('payment plan queries', () => {
  it('drops plans whose invoice is an abandoned (DRAFT) checkout', async () => {
    const { client } = mockClient({ plans: [plan('real'), plan('abandoned')], draftIds: ['abandoned'] })
    const { plans, error } = await fetchStartedPlanSummaries(client)
    expect(error).toBeNull()
    expect(plans.map(p => p.invoice_id)).toEqual(['real'])
  })

  it('keeps a started plan even when no installment has been paid yet', async () => {
    const { client } = mockClient({ plans: [plan('deferred-first-payment')], draftIds: [] })
    const { plans } = await fetchStartedPlanSummaries(client)
    expect(plans).toHaveLength(1)
  })

  it('scopes the abandoned lookup to one user when asked', async () => {
    const { client, draftQueries } = mockClient({ plans: [], draftIds: [] })
    await fetchAbandonedPlanInvoiceIds(client, 'u1')
    expect(draftQueries[0]).toMatchObject({ is_payment_plan: true, invoice_status: 'DRAFT', 'staging_metadata->>user_id': 'u1' })
  })

  it('reports an error instead of returning unfiltered plans', async () => {
    const { client } = mockClient({ plans: [], draftIds: [], summaryError: 'boom' })
    expect(await fetchStartedPlanSummaries(client)).toEqual({ plans: [], error: 'boom' })
  })
})
