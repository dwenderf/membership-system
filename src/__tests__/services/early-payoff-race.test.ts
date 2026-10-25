/**
 * #452: early payoff concurrency, idempotency, rollback, synchronous completion + webhook
 * backstop, and the installment cron's conditional claim. Uses an in-memory Supabase fake that
 * keeps real row state across queries and interleaves concurrent callers between queries.
 */
import { createFakeSupabase } from '@/__test-utils__/fake-supabase'

let fake: ReturnType<typeof createFakeSupabase>
const createIntent = jest.fn()
const cancelIntent = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: () => fake
}))
jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: () => ({ paymentIntents: { create: createIntent, cancel: cancelIntent } })
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logBatchProcessing: jest.fn(), logXeroSync: jest.fn() }
}))
jest.mock('@/lib/payment-method-utils', () => ({ userHasValidPaymentMethod: jest.fn() }))

import {
  PaymentPlanService,
  earlyPayoffIdempotencyKey,
  installmentIdempotencyKey
} from '@/lib/services/payment-plan-service'
import { completeEarlyPayoff } from '@/lib/services/early-payoff-completion'

const INV = 'inv-1'
const USER = 'user-1'

function seed() {
  const xeroInvoice = { id: INV, user_registrations: [{ user_id: USER, registration: { name: 'Spring', season: { name: 'Squall' } } }] }
  fake = createFakeSupabase({
    users: [{ id: USER, stripe_payment_method_id: 'pm_1', stripe_customer_id: 'cus_1', email: 'd@example.com', first_name: 'D', last_name: 'W' }],
    xero_invoices: [{ id: INV, is_payment_plan: true, staging_metadata: { user_id: USER }, user_registrations: xeroInvoice.user_registrations }],
    xero_payments: [
      { id: 'xp1', xero_invoice_id: INV, payment_type: 'installment', installment_number: 1, amount_paid: 3125, sync_status: 'synced', attempt_count: 1, staging_metadata: { user_registration_id: 'ur1' }, xero_invoice: xeroInvoice },
      { id: 'xp2', xero_invoice_id: INV, payment_type: 'installment', installment_number: 2, amount_paid: 3125, sync_status: 'planned', attempt_count: 0, staging_metadata: { user_registration_id: 'ur1' }, xero_invoice: xeroInvoice, planned_payment_date: '2026-10-25' },
      { id: 'xp3', xero_invoice_id: INV, payment_type: 'installment', installment_number: 3, amount_paid: 3125, sync_status: 'planned', attempt_count: 0, staging_metadata: { user_registration_id: 'ur1' }, xero_invoice: xeroInvoice },
      { id: 'xp4', xero_invoice_id: INV, payment_type: 'installment', installment_number: 4, amount_paid: 3125, sync_status: 'planned', attempt_count: 0, staging_metadata: { user_registration_id: 'ur1' }, xero_invoice: xeroInvoice }
    ],
    payments: []
  })
}

let piCounter = 0
const succeeded = () =>
  createIntent.mockImplementation(async (params: { metadata: Record<string, string> }) => ({
    id: `pi_${++piCounter}`, status: 'succeeded', metadata: params.metadata
  }))

const payoffRows = () => fake.rows('xero_payments').filter(r => r.payment_type === 'full')
const installments = () => fake.rows('xero_payments').filter(r => r.payment_type === 'installment')

beforeEach(() => {
  jest.clearAllMocks()
  createIntent.mockReset()
  piCounter = 0
  seed()
})

describe('processEarlyPayoff', () => {
  it('charges once when two payoffs race (two tabs / double submit)', async () => {
    succeeded()
    const [a, b] = await Promise.all([
      PaymentPlanService.processEarlyPayoff(INV, USER),
      PaymentPlanService.processEarlyPayoff(INV, USER)
    ])

    expect(createIntent).toHaveBeenCalledTimes(1)
    expect(createIntent.mock.calls[0][0].amount).toBe(9375)
    expect([a.success, b.success].sort()).toEqual([false, true])
    const loser = a.success ? b : a
    expect(['nothing_to_pay', 'in_progress']).toContain(loser.code)
    expect(payoffRows().filter(r => r.sync_status !== 'cancelled')).toHaveLength(1)
  })

  it('a second payoff after success is rejected without charging', async () => {
    succeeded()
    expect((await PaymentPlanService.processEarlyPayoff(INV, USER)).success).toBe(true)
    const again = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(again.success).toBe(false)
    expect(createIntent).toHaveBeenCalledTimes(1)
  })

  it('marks paid synchronously and passes a claim-scoped idempotency key', async () => {
    succeeded()
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result).toMatchObject({ success: true, totalPaid: 9375 })

    const [row] = payoffRows()
    expect(row.sync_status).toBe('pending')
    expect(row.staging_metadata).toMatchObject({ early_payoff: true, stripe_payment_intent_id: 'pi_1', payment_id: result.paymentId })
    expect(fake.rows('payments')[0]).toMatchObject({ status: 'completed', stripe_payment_intent_id: 'pi_1' })
    expect(installments().filter(r => r.sync_status === 'planned')).toHaveLength(0)

    const [, options] = createIntent.mock.calls[0]
    expect(options).toEqual({ idempotencyKey: earlyPayoffIdempotencyKey(INV, 9375, row.id) })
    expect(options.idempotencyKey).toBe(`early-payoff:${INV}:9375:${row.id}`)
  })

  it('rolls back on a declined card, and a retry then works', async () => {
    createIntent.mockRejectedValueOnce(Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' }))
    const declined = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(declined).toMatchObject({ success: false, code: 'charge_failed' })

    expect(installments().filter(r => r.sync_status === 'planned').map(r => r.id)).toEqual(['xp2', 'xp3', 'xp4'])
    expect(payoffRows().map(r => r.sync_status)).toEqual(['cancelled'])
    expect(fake.rows('payments')[0].status).toBe('failed')

    succeeded()
    const retry = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(retry).toMatchObject({ success: true, totalPaid: 9375 })
    // fresh claim -> fresh idempotency key
    expect(createIntent.mock.calls[1][1].idempotencyKey).not.toBe(createIntent.mock.calls[0][1].idempotencyKey)
  })

  it('rolls back and cancels the intent on requires_action', async () => {
    createIntent.mockResolvedValueOnce({ id: 'pi_ra', status: 'requires_action', metadata: {} })
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result).toMatchObject({ success: false, code: 'charge_failed' })
    expect(cancelIntent).toHaveBeenCalledWith('pi_ra')
    expect(installments().filter(r => r.sync_status === 'planned')).toHaveLength(3)
    expect(payoffRows()[0].sync_status).toBe('cancelled')
  })

  it('keeps the claim when the charge outcome is unknown (network error)', async () => {
    createIntent.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }))
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result.success).toBe(false)
    expect(installments().filter(r => r.sync_status === 'planned')).toHaveLength(0)
    expect(payoffRows()[0].sync_status).toBe('staged')
    // ...and nothing else can charge meanwhile
    succeeded()
    expect((await PaymentPlanService.processEarlyPayoff(INV, USER)).success).toBe(false)
    expect(createIntent).toHaveBeenCalledTimes(1)
  })
})

describe('completeEarlyPayoff (sync path + webhook backstop)', () => {
  it('is idempotent: webhook after the sync completion is a no-op apart from fees', async () => {
    succeeded()
    await PaymentPlanService.processEarlyPayoff(INV, USER)
    const [row] = payoffRows()
    const payment = fake.rows('payments')[0]
    const completedAt = payment.completed_at

    const pi = { id: 'pi_1', metadata: { paymentId: payment.id, xeroStagingRecordId: INV } }
    const r1 = await completeEarlyPayoff(fake, pi, { stripeFeeAmount: 300, stripeChargeId: 'ch_1' })
    const r2 = await completeEarlyPayoff(fake, pi, { stripeFeeAmount: 300, stripeChargeId: 'ch_1' })

    expect(r1.transitioned).toBe(false)
    expect(r2.transitioned).toBe(false)
    expect(r1.xeroPaymentId).toBe(row.id)
    expect(fake.rows('payments')[0]).toMatchObject({ status: 'completed', stripe_fee_amount: 300, stripe_charge_id: 'ch_1', completed_at: completedAt })
    expect(payoffRows()[0]).toMatchObject({ sync_status: 'pending' })
    expect(payoffRows()[0].staging_metadata.stripe_charge_id).toBe('ch_1')
  })

  it('webhook completes a staged payoff (sync path never ran) and finds it by intent id, not .single()', async () => {
    fake.rows('payments').push({ id: 'pay-x', status: 'pending' })
    // A rolled-back attempt on the same invoice must not confuse the lookup
    fake.rows('xero_payments').push(
      { id: 'old', xero_invoice_id: INV, payment_type: 'full', sync_status: 'cancelled', staging_metadata: { early_payoff: true, stripe_payment_intent_id: 'pi_old' } },
      { id: 'live', xero_invoice_id: INV, payment_type: 'full', sync_status: 'staged', staging_metadata: { early_payoff: true, stripe_payment_intent_id: 'pi_live', payment_id: 'pay-x' } }
    )
    const result = await completeEarlyPayoff(fake, { id: 'pi_live', metadata: { paymentId: 'pay-x', xeroStagingRecordId: INV } })
    expect(result).toMatchObject({ xeroPaymentId: 'live', transitioned: true })
    expect(fake.rows('xero_payments').find(r => r.id === 'live')!.sync_status).toBe('pending')
    expect(fake.rows('xero_payments').find(r => r.id === 'old')!.sync_status).toBe('cancelled')
  })

  it('throws (so Stripe retries the webhook) when the records are missing', async () => {
    await expect(completeEarlyPayoff(fake, { id: 'pi_z', metadata: { paymentId: 'nope', xeroStagingRecordId: INV } })).rejects.toThrow()
  })
})

describe('installment cron vs early payoff', () => {
  it('skips an installment an early payoff already cancelled', async () => {
    succeeded()
    await PaymentPlanService.processEarlyPayoff(INV, USER)
    createIntent.mockClear()
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, skipped: true })
    expect(createIntent).not.toHaveBeenCalled()
    expect(installments().find(r => r.id === 'xp2')!.sync_status).toBe('cancelled')
  })

  it('skips plans with an early payoff in flight', async () => {
    fake.rows('xero_payments').push({ id: 'inflight', xero_invoice_id: INV, payment_type: 'full', sync_status: 'staged', staging_metadata: { early_payoff: true } })
    succeeded()
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, skipped: true })
    expect(createIntent).not.toHaveBeenCalled()
  })

  it('never charges more than the remaining balance when cron and payoff race', async () => {
    succeeded()
    await Promise.all([
      PaymentPlanService.processPaymentPlanTransaction('xp2'),
      PaymentPlanService.processEarlyPayoff(INV, USER)
    ])
    const charged = createIntent.mock.calls.reduce((sum, [p]) => sum + p.amount, 0)
    expect(charged).toBe(9375)
  })

  it('uses a per-attempt idempotency key for installments', async () => {
    succeeded()
    await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(createIntent.mock.calls[0][1]).toEqual({ idempotencyKey: installmentIdempotencyKey('xp2', 1) })
    expect(createIntent.mock.calls[0][1].idempotencyKey).toBe('installment:xp2:attempt:1')
  })

  it('does not resurrect a cancelled row when the installment run throws', async () => {
    createIntent.mockRejectedValueOnce(new Error('boom'))
    await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(installments().find(r => r.id === 'xp2')!.sync_status).toBe('planned') // own claim undone
    fake.rows('xero_payments').find(r => r.id === 'xp3')!.sync_status = 'cancelled'
    const r = await PaymentPlanService.processPaymentPlanTransaction('xp3')
    expect(r.skipped).toBe(true)
    expect(installments().find(r => r.id === 'xp3')!.sync_status).toBe('cancelled')
  })
})
