/**
 * #457: checkDiscountCodeReuse goes by the refund record linked to an earlier credit note.
 */
import { checkDiscountCodeReuse } from '@/lib/refunds/discount-refund-guards'

type Result = { data: unknown; error: unknown }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  ;['select', 'eq', 'in'].forEach(m => { c[m] = jest.fn(() => c) })
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}
const ok = (data: unknown): Result => ({ data, error: null })
const line = (sync_status: string, refund_id: string | null) =>
  ({ id: 'cn-line', xero_invoices: { payment_id: 'pay', invoice_type: 'ACCRECCREDIT', sync_status, staging_metadata: { refund_id } } })

function run(queue: Result[]) {
  const tables: string[] = []
  const supabase = { from: jest.fn((t: string) => { tables.push(t); return chain(queue.shift() as Result) }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { result: checkDiscountCodeReuse(supabase as any, 'pay', 'inv', 'code'), tables }
}

describe('checkDiscountCodeReuse: refund-linked credit notes (#457)', () => {
  it('frees the code when the linked refund failed', async () => {
    const { result, tables } = run([ok([]), ok([line('ignore', 'r1')]), ok([{ id: 'r1', status: 'failed' }])])
    expect(await result).toEqual({ status: 'unused' })
    expect(tables).toEqual(['xero_invoice_line_items', 'xero_invoice_line_items', 'refunds'])
  })

  it('frees the code when the linked refund was cancelled', async () => {
    const { result } = run([ok([]), ok([line('ignore', 'r1')]), ok([{ id: 'r1', status: 'cancelled' }])])
    expect(await result).toEqual({ status: 'unused' })
  })

  it('blocks the code while the linked refund is pending, even with the credit note staged', async () => {
    const { result } = run([ok([]), ok([line('staged', 'r1')]), ok([{ id: 'r1', status: 'pending' }])])
    expect(await result).toEqual({ status: 'reused', source: 'refund' })
  })

  it('blocks when the linked refund is completed but its credit note failed to sync', async () => {
    const { result } = run([ok([]), ok([line('failed', 'r1')]), ok([{ id: 'r1', status: 'completed' }])])
    expect(await result).toEqual({ status: 'reused', source: 'refund' })
  })

  it('fails closed when the refund_id has no refunds row', async () => {
    const { result } = run([ok([]), ok([line('staged', 'r1')]), ok([])])
    expect(await result).toEqual({ status: 'reused', source: 'refund' })
  })

  it('returns error when the refunds lookup errors', async () => {
    const { result } = run([ok([]), ok([line('staged', 'r1')]), { data: null, error: { message: 'boom' } }])
    expect(await result).toEqual({ status: 'error' })
  })

  it('blocks if any one of several linked refunds is still live', async () => {
    const { result } = run([ok([]), ok([line('ignore', 'r1'), line('staged', 'r2')]), ok([{ id: 'r1', status: 'failed' }, { id: 'r2', status: 'pending' }])])
    expect(await result).toEqual({ status: 'reused', source: 'refund' })
  })

  it('ignores an unconfirmed preview without querying refunds', async () => {
    const { result, tables } = run([ok([]), ok([line('staged', null)])])
    expect(await result).toEqual({ status: 'unused' })
    expect(tables).not.toContain('refunds')
  })
})
