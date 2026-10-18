/**
 * A payment that completes after the daily housekeeping sweep abandoned its cart must still find
 * and promote its invoice, instead of logging "staging record not found" with the money collected.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const mockLog = jest.fn()
jest.mock('@/lib/logging/logger', () => ({
  Logger: { getInstance: () => ({ logPaymentProcessing: (...a: unknown[]) => mockLog(...a) }) },
}))
jest.mock('@/lib/xero/staging', () => ({ xeroStagingManager: {} }))
jest.mock('@/lib/email', () => ({ emailProcessor: {} }))

interface Call {
  table: string
  op: 'select' | 'update'
  filters: Array<[string, ...unknown[]]>
  values?: Record<string, unknown>
}

const calls: Call[] = []
let invoiceRow: Record<string, unknown> | null = null

jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'limit', 'single']) {
        q[m] = (...args: unknown[]) => { call.filters.push([m, ...args]); return q }
      }
      q.update = (values: Record<string, unknown>) => { call.op = 'update'; call.values = values; return q }
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        calls.push(call)
        let data: unknown = null
        if (table === 'xero_invoices' && call.op === 'select') data = invoiceRow ? [invoiceRow] : []
        if (table === 'system_accounting_codes') data = { accounting_code: '090' }
        return Promise.resolve({ data, error: null }).then(res, rej)
      }
      return q
    },
  }),
}))

import { PaymentCompletionProcessor } from '@/lib/payment-completion-processor'

type Internals = {
  findExistingStagingRecords(event: unknown): Promise<Record<string, unknown> | null>
  updateXeroStagingRecords(event: unknown, existing: unknown, options: { success: boolean }): Promise<void>
}

const event = {
  event_type: 'user_registrations',
  record_id: 'ur-1',
  user_id: 'u-1',
  payment_id: 'pay-1',
  amount: 5000,
  trigger_source: 'webhook',
  timestamp: new Date().toISOString(),
  metadata: { xero_staging_record_id: 'inv-1', payment_intent_id: 'pi_1' },
}

const internals = () => new PaymentCompletionProcessor() as unknown as Internals
const inFilter = (call: Call) => call.filters.find(f => f[0] === 'in' && f[1] === 'sync_status')?.[2] as string[]

beforeEach(() => {
  calls.length = 0
  mockLog.mockClear()
  invoiceRow = null
})

describe('payment completion for an abandoned cart', () => {
  it('finds an invoice that the sweep abandoned, and says so loudly', async () => {
    invoiceRow = { id: 'inv-1', sync_status: 'abandoned', sync_error: 'swept', invoice_status: 'DRAFT', payment_id: 'pay-1', net_amount: 5000 }

    const found = await internals().findExistingStagingRecords(event)

    expect(found).toMatchObject({ id: 'inv-1', sync_status: 'abandoned' })
    expect(inFilter(calls[0])).toEqual(expect.arrayContaining(['staged', 'pending', 'synced', 'abandoned']))
    const revival = mockLog.mock.calls.find(c => String(c[1]).includes('Reviving an abandoned staging record'))
    expect(revival).toBeDefined()
    expect(revival![3]).toBe('warn') // level
  })

  it('does not log a revival for an ordinary staged invoice', async () => {
    invoiceRow = { id: 'inv-1', sync_status: 'staged', invoice_status: 'DRAFT', payment_id: 'pay-1', net_amount: 5000 }
    await internals().findExistingStagingRecords(event)
    expect(mockLog.mock.calls.some(c => String(c[1]).includes('Reviving'))).toBe(false)
  })

  it('promotes the invoice and its payments to pending and clears the abandon reason', async () => {
    const existing = { id: 'inv-1', sync_status: 'abandoned', staging_metadata: {} }

    await internals().updateXeroStagingRecords(event, existing, { success: true })

    const invoiceUpdate = calls.find(c => c.table === 'xero_invoices' && c.op === 'update')!
    expect(invoiceUpdate.values).toMatchObject({
      sync_status: 'pending',
      invoice_status: 'AUTHORISED',
      payment_id: 'pay-1',
      sync_error: null,
    })
    const paymentUpdate = calls.find(c => c.table === 'xero_payments' && c.op === 'update')!
    expect(paymentUpdate.values).toMatchObject({ sync_status: 'pending', sync_error: null })

    // the metadata lookup must also see abandoned rows, or their staging metadata would be dropped
    const metadataLookup = calls.find(c => c.table === 'xero_payments' && c.op === 'select')!
    expect(inFilter(metadataLookup)).toEqual(expect.arrayContaining(['staged', 'abandoned']))
  })
})

describe('stripe webhook payment plan statuses', () => {
  // updatePaymentPlanStatuses is not exported (Next route modules may only export handlers), so this
  // guards the source: abandoned installments must be revived to pending/planned like staged ones.
  const source = readFileSync(join(process.cwd(), 'src/app/api/stripe-webhook/route.ts'), 'utf8')
  const fn = source.slice(
    source.indexOf('async function updatePaymentPlanStatuses'),
    source.indexOf('// Handle membership payment processing')
  )

  it('revives abandoned installments as well as staged ones', () => {
    expect(fn).toContain(".update({ sync_status: 'pending', sync_error: null })")
    expect(fn).toContain(".update({ sync_status: 'planned', sync_error: null })")
    expect(fn.match(/\.in\('sync_status', \['staged', 'abandoned'\]\)/g)).toHaveLength(2)
    expect(fn).not.toMatch(/\.eq\('sync_status', 'staged'\)/)
  })
})
