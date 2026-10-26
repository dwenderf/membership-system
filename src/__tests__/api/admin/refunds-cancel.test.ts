/**
 * #457: admin cancel of a confirmed-but-unsubmitted refund must actually reach 'cancelled'
 * (which frees its discount code). It used to also write a non-existent failure_reason column,
 * so the update errored and the refund stayed pending.
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({ Logger: { getInstance: () => ({ logSystem: jest.fn() }) } }))

import { POST } from '@/app/api/admin/refunds/cancel/route'
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

const REFUND_COLUMNS = ['id', 'payment_id', 'user_id', 'amount', 'reason', 'stripe_refund_id', 'xero_credit_note_id', 'status', 'processed_by', 'created_at', 'updated_at', 'completed_at', 'stripe_payment_intent_id', 'stripe_charge_id']

function makeDb() {
  const state = { refund: { id: 'r1', status: 'pending' }, note: { id: 'stg', sync_status: 'staged' } }
  const supabase = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin' } } }) },
    from: (table: string) => {
      let values: Record<string, unknown> | null = null
      const filters: Record<string, unknown> = {}
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters[c] = v; return q },
        update: (v: Record<string, unknown>) => { values = v; return q },
        single: () => Promise.resolve({ data: { is_admin: true }, error: null }),
        then: (res: (v: unknown) => unknown) => {
          let error: unknown = null
          if (values && table === 'refunds') {
            const bad = Object.keys(values).find(k => !REFUND_COLUMNS.includes(k))
            if (bad) error = { message: `column "${bad}" does not exist` }
            else if (state.refund.status === filters.status) Object.assign(state.refund, values)
          }
          if (values && table === 'xero_invoices' && state.note.sync_status === filters.sync_status) Object.assign(state.note, values)
          return Promise.resolve({ data: null, error }).then(res)
        },
      }
      return q
    },
  }
  return { supabase, state }
}

describe('POST /api/admin/refunds/cancel (#457)', () => {
  it('marks the pending refund cancelled and ignores its staging', async () => {
    const db = makeDb()
    ;(createClient as jest.Mock).mockResolvedValue(db.supabase)
    const res = await POST(new NextRequest('http://localhost/api/admin/refunds/cancel', {
      method: 'POST', body: JSON.stringify({ refundId: 'r1', stagingId: 'stg' }),
    }))
    expect(res.status).toBe(200)
    expect(db.state.refund.status).toBe('cancelled')
    expect(db.state.note.sync_status).toBe('ignore')
  })
})
