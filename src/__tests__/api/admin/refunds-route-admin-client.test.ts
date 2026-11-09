/**
 * POST /api/admin/refunds must update payments through createAdminClient()
 * after the admin check. authenticated has no UPDATE on payments, so a
 * signed-in-client write would leave a successful Stripe refund without a
 * matching payment-row change. Non-admins must get 403 before Stripe runs.
 */

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: jest.fn(),
}))

jest.mock('@/lib/logging/logger', () => ({
  Logger: {
    getInstance: jest.fn(),
  },
}))

import { POST } from '@/app/api/admin/refunds/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { Logger } from '@/lib/logging/logger'
import { NextRequest } from 'next/server'

type ChainResult = { data: unknown; error: unknown }

function makeChain(result: ChainResult) {
  const chain: Record<string, jest.Mock> & {
    then: (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>
  } = {} as never
  ;['select', 'insert', 'update', 'eq', 'in'].forEach((method) => {
    chain[method] = jest.fn(() => chain)
  })
  chain.single = jest.fn(() => Promise.resolve(result))
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function queueFrom(queues: Record<string, ReturnType<typeof makeChain>[]>) {
  return jest.fn((table: string) => {
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected supabase.from('${table}') call - no queued response left`)
    }
    return queue.shift()
  })
}

const mockLogger = { logSystem: jest.fn() }

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/refunds', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/refunds - admin client payment update', () => {
  const paymentRow = {
    id: 'payment-1',
    user_id: 'user-1',
    final_amount: 5000,
    status: 'completed',
    stripe_payment_intent_id: 'pi_test',
  }

  const refundRow = {
    id: 'refund-1',
    payment_id: 'payment-1',
    user_id: 'user-1',
    amount: 5000,
    status: 'pending',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(Logger.getInstance as jest.Mock).mockReturnValue(mockLogger)
  })

  it('returns 403 for a non-admin before calling Stripe', async () => {
    const stripeCreate = jest.fn()
    ;(getStripe as jest.Mock).mockReturnValue({ refunds: { create: stripeCreate } })

    const usersChain = makeChain({ data: { is_admin: false }, error: null })
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'member-1' } } }) },
      from: queueFrom({ users: [usersChain] }),
    }
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    const adminFrom = jest.fn()
    ;(createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom })

    const res = await POST(buildRequest({ paymentId: 'payment-1', amount: 5000, reason: 'test' }))

    expect(res.status).toBe(403)
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(adminFrom).not.toHaveBeenCalled()
  })

  it('updates payments through createAdminClient after a successful Stripe refund', async () => {
    const stripeCreate = jest.fn().mockResolvedValue({ id: 're_test' })
    ;(getStripe as jest.Mock).mockReturnValue({ refunds: { create: stripeCreate } })

    const usersChain = makeChain({ data: { is_admin: true }, error: null })
    const paymentsSelect = makeChain({ data: paymentRow, error: null })
    const existingRefunds = makeChain({ data: [], error: null })
    const refundsInsert = makeChain({ data: refundRow, error: null })
    const refundsProcessing = makeChain({ data: null, error: null })
    const refundsCompleted = makeChain({ data: null, error: null })
    const adminPaymentsUpdate = makeChain({ data: null, error: null })

    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
      from: queueFrom({
        users: [usersChain],
        payments: [paymentsSelect],
        refunds: [existingRefunds, refundsInsert, refundsProcessing, refundsCompleted],
      }),
    }
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)

    const adminFrom = queueFrom({
      payments: [adminPaymentsUpdate],
    })
    ;(createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom })

    const res = await POST(buildRequest({ paymentId: 'payment-1', amount: 5000, reason: 'full refund' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(stripeCreate).toHaveBeenCalledTimes(1)
    expect(createAdminClient).toHaveBeenCalled()
    expect(adminFrom).toHaveBeenCalledWith('payments')
    expect(adminPaymentsUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'refunded',
        refund_reason: 'full refund',
        refunded_by: 'admin-1',
      })
    )
    expect(adminPaymentsUpdate.eq).toHaveBeenCalledWith('id', 'payment-1')
    // Session client may SELECT payments once; the UPDATE must be on adminFrom.
    const sessionPaymentCalls = (mockSupabase.from as jest.Mock).mock.calls.filter(
      (c: string[]) => c[0] === 'payments'
    )
    expect(sessionPaymentCalls).toHaveLength(1)
    expect(paymentsSelect.update).not.toHaveBeenCalled()
  })
})
