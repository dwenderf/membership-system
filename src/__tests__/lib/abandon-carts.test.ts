/**
 * #332: the cart sweep also abandons staged invoices that have a payment_id, but only when the
 * payment provably never succeeded. A completed payment must never be touched.
 */
import { abandonCartsBeforePayment, abandonCartsWithPayment } from '@/lib/cron/abandon-carts'

interface Call {
  table: string
  op: 'select' | 'update'
  filters: Array<[string, ...unknown[]]>
  values?: Record<string, unknown>
}

type Handler = (call: Call) => { data?: unknown; error?: { message: string } | null }

function fakeClient(handler: Handler) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const q: Record<string, unknown> = {}
      for (const m of ['eq', 'is', 'not', 'in', 'or', 'order', 'limit']) {
        q[m] = (...args: unknown[]) => { call.filters.push([m, ...args]); return q }
      }
      q.select = (...args: unknown[]) => { call.filters.push(['select', ...args]); return q }
      q.update = (values: Record<string, unknown>) => { call.op = 'update'; call.values = values; return q }
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        calls.push(call)
        const { data = null, error = null } = handler(call)
        return Promise.resolve({ data, error }).then(res, rej)
      }
      return q
    },
  }
  return { client: client as never, calls }
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString()
const idsOf = (call: Call) => call.filters.find(f => f[0] === 'in')?.[2] as string[]
const updates = (calls: Call[], table: string) => calls.filter(c => c.table === table && c.op === 'update')

const invoice = (id: string, payment_id: string, stagedHoursAgo = 48) => ({
  id, payment_id, staged_at: hoursAgo(stagedHoursAgo), created_at: hoursAgo(stagedHoursAgo),
})

describe('abandonCartsWithPayment', () => {
  /**
   * @param paymentStatuses payment id -> status
   * @param promoted        payment id -> net_amount of each promoted invoice carrying it
   * @param finalAmounts    payment id -> final_amount (default 5000)
   */
  function run(
    candidates: unknown[],
    paymentStatuses: Record<string, string>,
    promoted: Record<string, number[]> = {},
    finalAmounts: Record<string, number> = {}
  ) {
    return fakeClient(call => {
      if (call.table === 'xero_invoices' && call.op === 'select') {
        // the promoted lookup filters by payment_id; the candidate select does not
        if (call.filters.some(f => f[0] === 'in' && f[1] === 'payment_id')) {
          return {
            data: idsOf(call).flatMap(payment_id => (promoted[payment_id] ?? []).map(net_amount => ({ payment_id, net_amount }))),
          }
        }
        return { data: candidates }
      }
      if (call.table === 'payments') {
        const ids = idsOf(call)
        return {
          data: ids.filter(id => id in paymentStatuses)
            .map(id => ({ id, status: paymentStatuses[id], final_amount: finalAmounts[id] ?? 5000 })),
        }
      }
      return { data: (idsOf(call) ?? []).map(id => ({ id })) } // updates echo the ids they touched
    })
  }

  it('abandons cancelled and failed payments; never completed ones, young pending ones or refunded ones', async () => {
    const { client, calls } = run(
      [
        invoice('inv-cancelled', 'p1'),
        invoice('inv-failed', 'p2'),
        invoice('inv-pending-recent', 'p4', 48),
        invoice('inv-completed', 'p5'),
        invoice('inv-refunded', 'p6'),
        invoice('inv-no-payment-row', 'p-missing'),
      ],
      { p1: 'cancelled', p2: 'failed', p4: 'pending', p5: 'completed', p6: 'refunded' }
    )

    const result = await abandonCartsWithPayment(client)

    expect(result).toMatchObject({ success: true, error: null, invoices: 2, needsReconciliation: 1, abandonedOnSettledPayment: 0, abandonedPendingPayment: 0 })
    expect(updates(calls, 'xero_invoices').flatMap(idsOf).sort()).toEqual(['inv-cancelled', 'inv-failed'])
  })

  it('abandons a cart whose payment has been pending for more than 7 days, but not one pending for less', async () => {
    const { client, calls } = run(
      [
        invoice('inv-pending-old', 'p-old', 24 * 7 + 2),
        invoice('inv-pending-ancient', 'p-ancient', 24 * 400),
        invoice('inv-pending-6d', 'p-6d', 24 * 6),
      ],
      { 'p-old': 'pending', 'p-ancient': 'pending', 'p-6d': 'pending' }
    )

    const result = await abandonCartsWithPayment(client)

    expect(result).toMatchObject({ success: true, invoices: 2, abandonedPendingPayment: 2 })
    expect(updates(calls, 'xero_invoices').flatMap(idsOf).sort()).toEqual(['inv-pending-ancient', 'inv-pending-old'])
    expect(updates(calls, 'xero_invoices')[0].values).toMatchObject({
      sync_status: 'abandoned',
      sync_error: expect.stringContaining('still pending after 7 days'),
    })
  })

  it('abandons an old cart stamped with a completed payment that promoted invoices fully carry', async () => {
    const { client, calls } = run(
      [invoice('inv-old-cart', 'p-settled')],
      { 'p-settled': 'completed' },
      { 'p-settled': [5000] }
    )

    const result = await abandonCartsWithPayment(client)

    expect(result).toMatchObject({ success: true, invoices: 1, abandonedOnSettledPayment: 1, needsReconciliation: 0 })
    expect(updates(calls, 'xero_invoices').flatMap(idsOf)).toEqual(['inv-old-cart'])
    expect(updates(calls, 'xero_invoices')[0].values).toMatchObject({
      sync_status: 'abandoned',
      sync_error: expect.stringContaining('completed for another invoice'),
    })
  })

  it('counts several promoted invoices toward covering one payment', async () => {
    const { client } = run(
      [invoice('inv-old-cart', 'p1')],
      { p1: 'completed' },
      { p1: [3000, 2000] }
    )
    expect(await abandonCartsWithPayment(client)).toMatchObject({ invoices: 1, abandonedOnSettledPayment: 1 })
  })

  it('never abandons a staged invoice whose completed payment is not fully covered', async () => {
    const { client, calls } = run(
      [
        invoice('inv-no-promoted', 'p-none'),
        invoice('inv-partly-covered', 'p-partial'),
      ],
      { 'p-none': 'completed', 'p-partial': 'completed' },
      { 'p-partial': [2000] } // 2000 of 5000 carried: the rest may be this invoice's revenue
    )

    const result = await abandonCartsWithPayment(client)

    expect(result).toMatchObject({ invoices: 0, abandonedOnSettledPayment: 0, needsReconciliation: 2 })
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('abandons a zero-amount payment already carried by a promoted zero-amount invoice', async () => {
    const { client } = run(
      [invoice('inv-free-old-cart', 'p-free')],
      { 'p-free': 'completed' },
      { 'p-free': [0] },
      { 'p-free': 0 }
    )
    expect(await abandonCartsWithPayment(client)).toMatchObject({ invoices: 1, abandonedOnSettledPayment: 1 })
  })

  it('never selects credit notes: only ACCREC invoices are candidates', async () => {
    const { client, calls } = run([], {})
    await abandonCartsWithPayment(client)
    const select = calls.find(c => c.table === 'xero_invoices')!
    expect(select.filters).toEqual(expect.arrayContaining([['eq', 'invoice_type', 'ACCREC']]))
  })

  it('only selects DRAFT staged invoices that have a payment_id', async () => {
    const { client, calls } = run([], {})
    await abandonCartsWithPayment(client)
    const select = calls.find(c => c.table === 'xero_invoices')!
    expect(select.filters).toEqual(expect.arrayContaining([
      ['eq', 'sync_status', 'staged'],
      ['eq', 'invoice_status', 'DRAFT'],
      ['not', 'payment_id', 'is', null],
    ]))
  })

  it('updates payments before invoices so a failure cannot strand an abandoned invoice', async () => {
    const { client, calls } = run([invoice('inv-1', 'p1')], { p1: 'cancelled' })
    await abandonCartsWithPayment(client)
    const writes = calls.filter(c => c.op === 'update').map(c => c.table)
    expect(writes).toEqual(['xero_payments', 'xero_invoices'])
  })

  it('chunks id lists so the request URL stays short', async () => {
    const candidates = Array.from({ length: 250 }, (_, i) => invoice(`inv-${i}`, `p${i}`))
    const statuses = Object.fromEntries(candidates.map(c => [c.payment_id, 'cancelled']))
    const { client, calls } = run(candidates, statuses)

    const result = await abandonCartsWithPayment(client)

    expect(result.invoices).toBe(250)
    for (const call of calls.filter(c => c.filters.some(f => f[0] === 'in'))) {
      expect(idsOf(call).length).toBeLessThanOrEqual(100)
    }
    expect(updates(calls, 'xero_invoices')).toHaveLength(3)
  })

  it('writes nothing and reports the error when the payment lookup fails', async () => {
    const { client, calls } = fakeClient(call => {
      if (call.table === 'xero_invoices') return { data: [invoice('inv-1', 'p1')] }
      return { error: { message: 'boom' } }
    })
    const result = await abandonCartsWithPayment(client)
    expect(result).toMatchObject({ success: false, error: 'payments lookup: boom' })
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })
})

describe('abandonCartsBeforePayment', () => {
  it('abandons staged invoices with no payment_id (unchanged behaviour)', async () => {
    const { client, calls } = fakeClient(call => {
      if (call.op === 'select') return { data: [{ id: 'a' }, { id: 'b' }] }
      return { data: idsOf(call).map(id => ({ id })) }
    })
    const result = await abandonCartsBeforePayment(client)
    expect(result).toMatchObject({ success: true, invoices: 2, payments: 2 })
    expect(calls[0].filters).toEqual(expect.arrayContaining([
      ['is', 'payment_id', null],
      ['eq', 'invoice_type', 'ACCREC'],
    ]))
  })

  it('returns early without writing when nothing is stale', async () => {
    const { client, calls } = fakeClient(() => ({ data: [] }))
    expect(await abandonCartsBeforePayment(client)).toMatchObject({ success: true, invoices: 0, payments: 0 })
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })
})
