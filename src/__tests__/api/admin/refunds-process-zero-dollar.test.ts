/**
 * Integration tests for the zero-dollar refund path of
 * POST /api/admin/refunds/process (see issue #45).
 *
 * A zero-dollar refund happens when a paid registration is fully covered by a
 * discount credit note (e.g. a $50 registration with a $50 discount line item),
 * so there is no Stripe payment to reverse. The route still has to: create a
 * completed refund record, stage the credit note for Xero sync, flip the
 * registrations/payment to refunded, and send the notification email -- all
 * without ever calling Stripe.
 */

// Mock dependencies BEFORE imports
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/email/refund-notification', () => ({
  stageRefundNotificationEmail: jest.fn()
}))

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: jest.fn()
}))

jest.mock('@/lib/logging/logger', () => ({
  Logger: {
    getInstance: jest.fn()
  }
}))

import { POST } from '@/app/api/admin/refunds/process/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { stageRefundNotificationEmail } from '@/lib/email/refund-notification'
import { getStripe } from '@/lib/stripe/server-client'
import { Logger } from '@/lib/logging/logger'
import { NextRequest } from 'next/server'

type ChainResult = { data: unknown; error: unknown }

/** Builds a chainable Supabase query-builder stub that resolves to `result`
 * whether the caller terminates the chain with `.single()` or awaits it directly. */
function makeChain(result: ChainResult) {
  const chain: Record<string, jest.Mock> & { then: (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown> } =
    {} as never
  ;['select', 'insert', 'update', 'eq', 'order', 'in'].forEach((method) => {
    chain[method] = jest.fn(() => chain)
  })
  chain.single = jest.fn(() => Promise.resolve(result))
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

/** Builds a `.from()` mock that returns queued chains per-table, in call order. */
function queueFrom(queues: Record<string, ReturnType<typeof makeChain>[]>) {
  return jest.fn((table: string) => {
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected supabase.from('${table}') call - no queued response left`)
    }
    return queue.shift()
  })
}

const mockLogger = {
  logPaymentProcessing: jest.fn(),
  logSystem: jest.fn()
}

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/refunds/process', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

describe('POST /api/admin/refunds/process - zero-dollar refunds', () => {
  const paymentRow = {
    id: 'payment-1',
    user_id: 'user-1',
    final_amount: 5000,
    stripe_payment_intent_id: null
  }

  const refundRow = {
    id: 'refund-1',
    payment_id: 'payment-1',
    user_id: 'user-1',
    amount: 0,
    status: 'completed'
  }

  let usersChain: ReturnType<typeof makeChain>
  let paymentsChain: ReturnType<typeof makeChain>
  let refundsInsertChain: ReturnType<typeof makeChain>
  let xeroInvoicesSelectChain: ReturnType<typeof makeChain>
  let xeroInvoicesUpdateChain: ReturnType<typeof makeChain>
  let refundsUpdateChain: ReturnType<typeof makeChain>
  let userRegSelectChain: ReturnType<typeof makeChain>
  let userRegUpdateChain: ReturnType<typeof makeChain>
  let adminPaymentsUpdateChain: ReturnType<typeof makeChain>

  let mockSupabase: { auth: { getUser: jest.Mock }; from: jest.Mock }
  let mockAdminSupabase: { from: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(Logger.getInstance as jest.Mock).mockReturnValue(mockLogger)
    ;(getStripe as jest.Mock).mockReturnValue({ refunds: { create: jest.fn() } })

    usersChain = makeChain({ data: { is_admin: true }, error: null })
    paymentsChain = makeChain({ data: paymentRow, error: null })
    refundsInsertChain = makeChain({ data: refundRow, error: null })
    xeroInvoicesSelectChain = makeChain({ data: { staging_metadata: { user_id: 'user-1' } }, error: null })
    xeroInvoicesUpdateChain = makeChain({ data: null, error: null })
    refundsUpdateChain = makeChain({ data: null, error: null })

    userRegSelectChain = makeChain({
      data: [
        { id: 'ur-1', payment_status: 'paid', registration_id: 'reg-1', user_id: 'user-1' }
      ],
      error: null
    })
    userRegUpdateChain = makeChain({ data: [{ id: 'ur-1' }], error: null })
    adminPaymentsUpdateChain = makeChain({ data: null, error: null })

    mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
      from: queueFrom({
        users: [usersChain],
        payments: [paymentsChain],
        refunds: [refundsInsertChain, refundsUpdateChain],
        xero_invoices: [xeroInvoicesSelectChain, xeroInvoicesUpdateChain]
      })
    }

    mockAdminSupabase = {
      from: queueFrom({
        user_registrations: [userRegSelectChain, userRegUpdateChain],
        payments: [adminPaymentsUpdateChain]
      })
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockReturnValue(mockAdminSupabase)
  })

  it('creates a completed refund and a pending credit-note staging update without calling Stripe', async () => {
    const request = buildRequest({
      stagingId: 'staging-1',
      reason: 'Discount covered full amount',
      paymentId: 'payment-1',
      refundAmount: 0
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.refund).toEqual({ id: 'refund-1', amount: 0, status: 'completed' })
    expect(data.message).toBe('Zero-dollar refund processed with credit note for accounting')

    // Refund record created as already-completed, never 'pending'
    expect(refundsInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: 'payment-1',
        amount: 0,
        status: 'completed',
        completed_at: expect.any(String)
      })
    )

    // Staging record marked pending for Xero sync, refund_id attached to metadata
    expect(xeroInvoicesUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'pending',
        staging_metadata: expect.objectContaining({ refund_id: 'refund-1' })
      })
    )

    // Stripe must never be touched for a zero-dollar refund
    expect(getStripe().refunds.create).not.toHaveBeenCalled()
  })

  it('does not require a Stripe payment intent on the payment record', async () => {
    // paymentRow.stripe_payment_intent_id is already null in the fixture above
    const request = buildRequest({
      stagingId: 'staging-1',
      paymentId: 'payment-1',
      refundAmount: 0
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('updates only paid user_registrations to refunded, filtering by payment_id and payment_status', async () => {
    const request = buildRequest({
      stagingId: 'staging-1',
      paymentId: 'payment-1',
      refundAmount: 0
    })

    await POST(request)

    expect(userRegUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: 'refunded', refunded_at: expect.any(String) })
    )
    expect(userRegUpdateChain.eq).toHaveBeenCalledWith('payment_id', 'payment-1')
    expect(userRegUpdateChain.eq).toHaveBeenCalledWith('payment_status', 'paid')
  })

  it('skips the registration update entirely when the payment has no paid registrations', async () => {
    userRegSelectChain = makeChain({
      data: [{ id: 'ur-1', payment_status: 'refunded', registration_id: 'reg-1', user_id: 'user-1' }],
      error: null
    })
    mockAdminSupabase.from = queueFrom({
      user_registrations: [userRegSelectChain],
      payments: [adminPaymentsUpdateChain]
    })

    const request = buildRequest({
      stagingId: 'staging-1',
      paymentId: 'payment-1',
      refundAmount: 0
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(userRegSelectChain.update).not.toHaveBeenCalled()
  })

  it('sends the refund notification email after a successful payment status update', async () => {
    const request = buildRequest({
      stagingId: 'staging-1',
      paymentId: 'payment-1',
      refundAmount: 0
    })

    await POST(request)

    expect(stageRefundNotificationEmail).toHaveBeenCalledWith('refund-1', 'user-1', 'payment-1')
  })

  it('rolls back the refund and registrations, returns 500, and does not email when the payment status update fails', async () => {
    adminPaymentsUpdateChain = makeChain({ data: null, error: { message: 'connection reset' } })
    const userRegRollbackChain = makeChain({ data: null, error: null })
    const refundsRollbackChain = makeChain({ data: null, error: null })
    mockAdminSupabase.from = queueFrom({
      user_registrations: [userRegSelectChain, userRegUpdateChain, userRegRollbackChain],
      payments: [adminPaymentsUpdateChain]
    })
    mockSupabase.from = queueFrom({
      users: [usersChain],
      payments: [paymentsChain],
      refunds: [refundsInsertChain, refundsUpdateChain, refundsRollbackChain],
      xero_invoices: [xeroInvoicesSelectChain, xeroInvoicesUpdateChain]
    })

    const request = buildRequest({
      stagingId: 'staging-1',
      paymentId: 'payment-1',
      refundAmount: 0
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to update payment status to refunded')

    // Refund rolled back to 'failed'
    expect(refundsRollbackChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )

    // Registrations rolled back from 'refunded' back to 'paid'
    expect(userRegRollbackChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: 'paid', refunded_at: null })
    )
    expect(userRegRollbackChain.eq).toHaveBeenCalledWith('payment_id', 'payment-1')
    expect(userRegRollbackChain.eq).toHaveBeenCalledWith('payment_status', 'refunded')

    // Email must not be sent when the payment update failed
    expect(stageRefundNotificationEmail).not.toHaveBeenCalled()
  })
})
