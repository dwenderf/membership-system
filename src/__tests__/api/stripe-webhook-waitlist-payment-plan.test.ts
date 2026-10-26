/**
 * payment_intent.succeeded for a waitlist selection charged as a payment plan (#442).
 *
 * The waitlist branch returns before the generic payment-plan branch, so it must promote the
 * staged installments itself (#1 pending, #2-4 planned) and tell the completion processor this is
 * a plan — otherwise the processor marks every installment row pending, i.e. paid in Xero.
 */
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock'

jest.mock('@/lib/supabase/server', () => ({ createAdminClient: jest.fn() }))
jest.mock('@/lib/stripe/server-client', () => ({ getStripe: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logSystem: jest.fn(), logPaymentProcessing: jest.fn(), logXeroSync: jest.fn(), reportWarningToSentry: jest.fn() }
}))
jest.mock('@/lib/membership-utils', () => ({ calculateMembershipStartDate: jest.fn(), calculateMembershipEndDate: jest.fn() }))
jest.mock('@/lib/xero/invoices', () => ({ deleteXeroDraftInvoice: jest.fn() }))
jest.mock('@/lib/payment-completion-processor', () => ({
  paymentProcessor: { processPaymentCompletion: jest.fn() }
}))
jest.mock('@/lib/email/refund-notification', () => ({ stageRefundNotificationEmail: jest.fn() }))
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: jest.fn() } }))

import { POST } from '@/app/api/stripe-webhook/route'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { NextRequest } from 'next/server'

interface Call { table: string; ops: Array<[string, unknown[]]> }

/** Records every query; resolves each from the table and the methods called on it. */
function makeDb() {
  const calls: Call[] = []
  const supabase = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const has = (m: string) => call.ops.some(([name]) => name === m)
      const resolve = () => {
        if (table === 'payments') return { data: { id: 'pay-1' }, error: null }
        if (table === 'user_registrations') return { data: { id: 'ur-1' }, error: null }
        if (table === 'xero_payments' && has('select') && has('order')) {
          return { data: [1, 2, 3, 4].map(n => ({ id: `xp${n}`, installment_number: n })), error: null }
        }
        if (table === 'xero_payments' && has('select')) return { data: { id: 'xp1', staging_metadata: { user_id: 'user-1' } }, error: null }
        return { data: null, error: null }
      }
      const proxy: Record<string, unknown> = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (ok: (v: unknown) => void) => Promise.resolve(resolve()).then(ok)
          if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(resolve())
          return (...args: unknown[]) => { call.ops.push([prop, args]); return proxy }
        }
      })
      return proxy
    }
  }
  return { supabase, calls }
}

function mockSucceeded(metadata: Record<string, string>) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', amount: 2500, metadata } }
      })
    },
    paymentIntents: { retrieve: jest.fn().mockResolvedValue({ latest_charge: { id: 'ch_1', balance_transaction: { fee: 103 } } }) }
  })
}

const baseMetadata = {
  purpose: 'waitlist_selection',
  userId: 'user-1',
  registrationId: 'reg-1',
  xeroStagingRecordId: 'inv-1'
}

function xeroPaymentUpdates(calls: Call[]) {
  return calls
    .filter(c => c.table === 'xero_payments' && c.ops.some(([m]) => m === 'update'))
    .map(c => ({
      update: c.ops.find(([m]) => m === 'update')![1][0] as Record<string, unknown>,
      eq: c.ops.filter(([m]) => m === 'eq').map(([, a]) => a),
      in: c.ops.filter(([m]) => m === 'in').map(([, a]) => a)
    }))
}

function post() {
  return POST(new NextRequest('http://localhost/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}'
  }))
}

describe('POST /api/stripe-webhook - waitlist payment plan (#442)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('promotes installment #1 to pending and #2-4 to planned, and flags the processor event as a plan', async () => {
    const db = makeDb()
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    mockSucceeded({ ...baseMetadata, isPaymentPlan: 'true', paymentPlanTotalAmount: '10000', paymentPlanInstallmentAmount: '2500' })

    const res = await post()
    expect(res.status).toBe(200)

    const updates = xeroPaymentUpdates(db.calls)
    // #1 metadata gets the payment/charge ids
    expect(updates).toContainEqual(expect.objectContaining({
      update: expect.objectContaining({ staging_metadata: expect.objectContaining({ payment_id: 'pay-1', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' }) }),
      eq: [['id', 'xp1']]
    }))
    expect(updates).toContainEqual(expect.objectContaining({
      update: expect.objectContaining({ sync_status: 'pending' }),
      eq: [['id', 'xp1']]
    }))
    expect(updates).toContainEqual(expect.objectContaining({
      update: expect.objectContaining({ sync_status: 'planned' }),
      in: [['id', ['xp2', 'xp3', 'xp4']], ['sync_status', ['staged', 'abandoned']]]
    }))

    expect(paymentProcessor.processPaymentCompletion).toHaveBeenCalledWith(expect.objectContaining({
      trigger_source: 'stripe_webhook_waitlist',
      metadata: expect.objectContaining({ is_payment_plan: true, payment_plan_id: 'inv-1', xero_staging_record_id: 'inv-1' })
    }))
  })

  it('leaves a full-charge waitlist selection to the processor as before', async () => {
    const db = makeDb()
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    mockSucceeded(baseMetadata)

    const res = await post()
    expect(res.status).toBe(200)

    expect(xeroPaymentUpdates(db.calls)).toHaveLength(0)
    const event = (paymentProcessor.processPaymentCompletion as jest.Mock).mock.calls[0][0]
    expect(event.metadata.is_payment_plan).toBeUndefined()
  })
})
