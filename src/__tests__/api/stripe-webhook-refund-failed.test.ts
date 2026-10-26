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

/**
 * #456 review: a Stripe refund that comes back failed/canceled marks our refund row
 * failed/cancelled (freeing its discount code) and keeps its unsynced credit note out of Xero.
 */
type Row = Record<string, unknown>
function makeDb(refund: Row | null, note: Row) {
  const updates: { table: string; values: Row; filters: [string, string, unknown][] }[] = []
  const supabase = {
    from: (table: string) => {
      let op: 'select' | 'update' = 'select'
      let values: Row = {}
      const filters: [string, string, unknown][] = []
      const q: Record<string, unknown> = {
        select: () => q,
        update: (v: Row) => { op = 'update'; values = v; return q },
        eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return q },
        in: (c: string, v: unknown) => { filters.push(['in', c, v]); return q },
        maybeSingle: () => {
          if (table === 'refunds') {
            const match = refund && filters.every(([, c, v]) => refund[c] === v)
            return Promise.resolve({ data: match ? refund : null, error: null })
          }
          return Promise.resolve({ data: note, error: null })
        },
        then: (res: (v: unknown) => unknown) => {
          if (op === 'update') {
            updates.push({ table, values, filters })
            const target = table === 'refunds' ? refund : table === 'xero_invoices' ? note : null
            const allowed = filters.find(f => f[0] === 'in')
            if (target && (!allowed || (allowed[2] as unknown[]).includes(target.sync_status))) Object.assign(target, values)
          }
          return Promise.resolve({ data: null, error: null }).then(res)
        },
      }
      return q
    },
  }
  return { supabase, updates }
}

function send(type: string, object: Row) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: { constructEvent: jest.fn().mockReturnValue({ id: 'evt_1', type, data: { object } }) },
  })
  return POST(new NextRequest('http://localhost/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  }))
}

describe('stripe webhook: failed/canceled refunds (#456)', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['refund.failed', 'failed', 'failed'],
    ['refund.updated', 'canceled', 'cancelled'],
    ['charge.refund.updated', 'failed', 'failed'],
  ])('%s with status %s marks the refund %s and ignores the staged credit note', async (type, stripeStatus, expected) => {
    const refund = { id: 'r1', status: 'pending', stripe_refund_id: 're_1' }
    const note = { id: 'stg', sync_status: 'staged' }
    const db = makeDb(refund, note)
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    const res = await send(type, { id: 're_1', object: 'refund', status: stripeStatus, metadata: { refund_id: 'r1', staging_id: 'stg' } })
    expect(res.status).toBe(200)
    expect(refund.status).toBe(expected)
    expect(note.sync_status).toBe('ignore')
  })

  it('falls back to metadata.refund_id when stripe_refund_id was never stored', async () => {
    const refund = { id: 'r1', status: 'pending', stripe_refund_id: null }
    const db = makeDb(refund, { id: 'stg', sync_status: 'pending' })
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    await send('refund.failed', { id: 're_1', status: 'failed', metadata: { refund_id: 'r1', staging_id: 'stg' } })
    expect(refund.status).toBe('failed')
  })

  it('leaves a refund alone on refund.updated that is not failed/canceled', async () => {
    const refund = { id: 'r1', status: 'pending', stripe_refund_id: 're_1' }
    const db = makeDb(refund, { id: 'stg', sync_status: 'staged' })
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    await send('refund.updated', { id: 're_1', status: 'succeeded', metadata: { refund_id: 'r1', staging_id: 'stg' } })
    expect(refund.status).toBe('pending')
    expect(db.updates).toHaveLength(0)
  })

  it('does not touch an already-synced credit note', async () => {
    const refund = { id: 'r1', status: 'completed', stripe_refund_id: 're_1' }
    const note = { id: 'stg', sync_status: 'synced' }
    const db = makeDb(refund, note)
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    await send('refund.failed', { id: 're_1', status: 'failed', metadata: { refund_id: 'r1', staging_id: 'stg' } })
    expect(refund.status).toBe('failed')
    expect(note.sync_status).toBe('synced')
  })
})
