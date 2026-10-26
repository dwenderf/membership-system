process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock'

jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: jest.fn()
}))

jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logSystem: jest.fn(),
    logPaymentProcessing: jest.fn()
  }
}))

jest.mock('@/lib/membership-utils', () => ({
  calculateMembershipStartDate: jest.fn(),
  calculateMembershipEndDate: jest.fn()
}))

jest.mock('@/lib/xero/invoices', () => ({
  deleteXeroDraftInvoice: jest.fn()
}))

jest.mock('@/lib/payment-completion-processor', () => ({
  paymentProcessor: {
    processPaymentCompletion: jest.fn()
  }
}))

jest.mock('@/lib/email/refund-notification', () => ({
  stageRefundNotificationEmail: jest.fn()
}))

const stageEmail = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: (...a: unknown[]) => stageEmail(...a) } }))

import { POST } from '@/app/api/stripe-webhook/route'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { NextRequest } from 'next/server'
import { stageRefundNotificationEmail } from '@/lib/email/refund-notification'

/**
 * #457: when a refund is released (failed/cancelled), restore the payment's refundable state, and
 * surface DB errors as 5xx so Stripe retries. Retries must converge with no repeated effects.
 */
type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
type Filter = [string, string, unknown]

function makeDb(tables: Tables) {
  const writes: { table: string; values: Row; hit: number }[] = []
  let failOn: ((table: string, op: string) => boolean) | null = null
  const matches = (row: Row, filters: Filter[]) => filters.every(([op, c, v]) =>
    op === 'eq' ? row[c] === v : op === 'in' ? (v as unknown[]).includes(row[c]) : !String(v).replace(/[()]/g, '').split(',').includes(String(row[c])))
  const supabase = {
    from: (table: string) => {
      let op = 'select'
      let values: Row = {}
      const filters: Filter[] = []
      const run = () => {
        if (failOn?.(table, op)) return { data: null, error: { message: `boom on ${table} ${op}` } }
        const rows = (tables[table] || []).filter(r => matches(r, filters))
        if (op === 'update') { rows.forEach(r => Object.assign(r, values)); writes.push({ table, values, hit: rows.length }) }
        if (op === 'insert') return { data: values, error: null }
        return { data: rows, error: null }
      }
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: Row) => { op = 'insert'; values = v; return q },
        update: (v: Row) => { op = 'update'; values = v; return q },
        eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return q },
        in: (c: string, v: unknown) => { filters.push(['in', c, v]); return q },
        not: (c: string, _o: string, v: unknown) => { filters.push(['not', c, v]); return q },
        maybeSingle: () => { const r = run(); return Promise.resolve({ data: r.error ? null : (r.data as Row[])[0] ?? null, error: r.error }) },
        single: () => { const r = run(); return Promise.resolve({ data: r.error ? null : (r.data as Row[])[0] ?? null, error: r.error ?? ((r.data as Row[]).length ? null : { message: 'none' }) }) },
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      }
      return q
    },
  }
  return { supabase, writes, setFail: (f: typeof failOn) => { failOn = f } }
}

function send(type: string, object: Row, charge?: Row) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: { constructEvent: jest.fn().mockReturnValue({ id: 'evt_1', type, data: { object } }) },
    charges: { retrieve: jest.fn().mockResolvedValue(charge) },
  })
  return POST(new NextRequest('http://localhost/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }))
}

const failedRefund = { id: 're_1', status: 'failed', metadata: { refund_id: 'r1', staging_id: 'stg' } }

function world(extraRefunds: Row[] = [], refundStatus = 'completed') {
  return {
    payments: [{ id: 'pay', stripe_payment_intent_id: 'pi_1', user_id: 'u1', status: 'refunded', final_amount: 10000, refund_reason: 'Fully refunded', refunded_by: 'admin' }],
    refunds: [{ id: 'r1', payment_id: 'pay', amount: 10000, status: refundStatus, stripe_refund_id: 're_1' }, ...extraRefunds],
    user_registrations: [{ id: 'ur1', payment_id: 'pay', payment_status: 'refunded', refunded_at: '2026-10-01' }],
    xero_invoices: [{ id: 'stg', sync_status: 'pending' }],
    xero_payments: [{ id: 'xp', xero_invoice_id: 'stg', sync_status: 'pending' }],
  }
}

describe('refund release restores the payment (#457)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('restores a fully refunded payment and its registrations when the full refund fails', async () => {
    const t = world()
    ;(createAdminClient as jest.Mock).mockReturnValue(makeDb(t).supabase)
    const res = await send('refund.failed', failedRefund)
    expect(res.status).toBe(200)
    expect(t.refunds[0].status).toBe('failed')
    expect(t.payments[0]).toMatchObject({ status: 'completed', refund_reason: null, refunded_by: null })
    expect(t.user_registrations[0]).toMatchObject({ payment_status: 'paid', refunded_at: null })
    expect(t.xero_invoices[0].sync_status).toBe('ignore')
  })

  it('with other completed partial refunds, restores to completed (partially refunded) and keeps registrations refunded', async () => {
    const t = world([{ id: 'r0', payment_id: 'pay', amount: 2500, status: 'completed' }])
    t.refunds[0].amount = 7500
    ;(createAdminClient as jest.Mock).mockReturnValue(makeDb(t).supabase)
    await send('refund.updated', { ...failedRefund, status: 'canceled' })
    expect(t.refunds[0].status).toBe('cancelled')
    expect(t.payments[0].status).toBe('completed')
    expect(t.user_registrations[0].payment_status).toBe('refunded')
  })

  it('leaves the payment refunded when the remaining completed refunds still cover it', async () => {
    const t = world([{ id: 'r0', payment_id: 'pay', amount: 10000, status: 'completed' }])
    ;(createAdminClient as jest.Mock).mockReturnValue(makeDb(t).supabase)
    await send('refund.failed', failedRefund)
    expect(t.payments[0].status).toBe('refunded')
  })

  it('never clobbers a newer payment state', async () => {
    const t = world()
    t.payments[0].status = 'completed' // already restored / changed elsewhere
    const db = makeDb(t)
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    await send('refund.failed', failedRefund)
    expect(db.writes.filter(w => w.table === 'payments')).toHaveLength(0)
  })

  it('returns 5xx when a release write errors', async () => {
    const t = world()
    const db = makeDb(t)
    db.setFail((table, op) => table === 'payments' && op === 'update')
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    const res = await send('refund.failed', failedRefund)
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('returns 5xx when the release fails inside charge.refunded', async () => {
    const t = world([], 'pending')
    const db = makeDb(t)
    db.setFail((table, op) => table === 'refunds' && op === 'update')
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    const res = await send('charge.refunded', { id: 'ch_1' }, { id: 'ch_1', payment_intent: 'pi_1', refunds: { data: [{ ...failedRefund, created: 1 }] } })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('a retry after a partial failure converges with no duplicate effects', async () => {
    const t = world()
    const db = makeDb(t)
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)

    // First delivery: refund flips, then the credit-note ignore errors -> 5xx.
    db.setFail((table, op) => table === 'xero_invoices' && op === 'update')
    expect((await send('refund.failed', failedRefund)).status).toBeGreaterThanOrEqual(500)
    expect(t.refunds[0].status).toBe('failed')
    expect(t.payments[0].status).toBe('completed')
    expect(t.xero_invoices[0].sync_status).toBe('pending')

    // Stripe retries: completes the rest, repeats nothing.
    db.setFail(null)
    const before = db.writes.length
    expect((await send('refund.failed', failedRefund)).status).toBe(200)
    const retryWrites = db.writes.slice(before)
    expect(retryWrites.filter(w => w.table === 'refunds')).toHaveLength(0)
    expect(retryWrites.filter(w => w.table === 'payments')).toHaveLength(0)
    expect(retryWrites.filter(w => w.table === 'user_registrations' && w.hit > 0)).toHaveLength(0)
    expect(t.xero_invoices[0].sync_status).toBe('ignore')

    // A third (duplicate) delivery is a no-op too.
    const before3 = db.writes.length
    expect((await send('refund.failed', failedRefund)).status).toBe(200)
    expect(db.writes.slice(before3).filter(w => w.hit > 0)).toHaveLength(0)
    expect(stageRefundNotificationEmail).not.toHaveBeenCalled()
  })
})
