/**
 * #452 (slim fix): early payoff passes a state-derived Stripe idempotency key, and restores the
 * plan when the charge is declined or needs authentication.
 */
import { createFakeSupabase } from '@/__test-utils__/fake-supabase'

let fake: ReturnType<typeof createFakeSupabase>
const createIntent = jest.fn()
const cancelIntent = jest.fn()

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createAdminClient: () => fake }))
jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: () => ({ paymentIntents: { create: createIntent, cancel: cancelIntent } })
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logBatchProcessing: jest.fn(), logXeroSync: jest.fn() }
}))
jest.mock('@/lib/payment-method-utils', () => ({ userHasValidPaymentMethod: jest.fn() }))

import { PaymentPlanService, earlyPayoffIdempotencyKey } from '@/lib/services/payment-plan-service'

const INV = 'inv-1'
const USER = 'user-1'

beforeEach(() => {
  createIntent.mockReset()
  cancelIntent.mockReset()
  fake = createFakeSupabase({
    users: [{ id: USER, stripe_payment_method_id: 'pm_1', stripe_customer_id: 'cus_1', email: 'd@example.com' }],
    xero_invoices: [{ id: INV, user_registrations: [{ registration: { name: 'Spring', season: { name: 'Squall' } } }] }],
    xero_payments: [
      { id: 'xp1', xero_invoice_id: INV, payment_type: 'installment', installment_number: 1, amount_paid: 3125, sync_status: 'synced', staging_metadata: {} },
      { id: 'xp3', xero_invoice_id: INV, payment_type: 'installment', installment_number: 3, amount_paid: 3125, sync_status: 'planned', staging_metadata: {} },
      { id: 'xp2', xero_invoice_id: INV, payment_type: 'installment', installment_number: 2, amount_paid: 3125, sync_status: 'planned', staging_metadata: {} },
      { id: 'xp4', xero_invoice_id: INV, payment_type: 'installment', installment_number: 4, amount_paid: 3125, sync_status: 'planned', staging_metadata: {} }
    ],
    payments: []
  })
})

const planned = () => fake.rows('xero_payments').filter(r => r.payment_type === 'installment' && r.sync_status === 'planned').map(r => r.id).sort()
const full = () => fake.rows('xero_payments').filter(r => r.payment_type === 'full')

describe('earlyPayoffIdempotencyKey', () => {
  it('is the same for the same payoff state regardless of row order', () => {
    expect(earlyPayoffIdempotencyKey(INV, 'pm_1', 9375, ['b', 'a', 'c'])).toBe(earlyPayoffIdempotencyKey(INV, 'pm_1', 9375, ['c', 'b', 'a']))
  })
  it('changes with the card, the amount or the set of rows', () => {
    const k = earlyPayoffIdempotencyKey(INV, 'pm_1', 9375, ['a', 'b'])
    expect(earlyPayoffIdempotencyKey(INV, 'pm_2', 9375, ['a', 'b'])).not.toBe(k)
    expect(earlyPayoffIdempotencyKey(INV, 'pm_1', 6250, ['a', 'b'])).not.toBe(k)
    expect(earlyPayoffIdempotencyKey(INV, 'pm_1', 9375, ['a'])).not.toBe(k)
    expect(k.length).toBeLessThanOrEqual(255)
  })
})

describe('processEarlyPayoff', () => {
  it('passes the state-derived idempotency key and charges the planned balance', async () => {
    createIntent.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result).toMatchObject({ success: true, totalPaid: 9375 })
    const [params, options] = createIntent.mock.calls[0]
    expect(params.amount).toBe(9375)
    expect(options).toEqual({ idempotencyKey: earlyPayoffIdempotencyKey(INV, 'pm_1', 9375, ['xp2', 'xp3', 'xp4']) })
    expect(planned()).toEqual([])
    expect(full()[0].sync_status).toBe('staged') // webhook completes it, unchanged
  })

  it('a double click with the same state sends the same key both times', async () => {
    createIntent.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })
    await Promise.all([PaymentPlanService.processEarlyPayoff(INV, USER), PaymentPlanService.processEarlyPayoff(INV, USER)])
    const keys = createIntent.mock.calls.map(c => c[1].idempotencyKey)
    expect(new Set(keys).size).toBe(1)
  })

  it('restores the installments on a declined card', async () => {
    createIntent.mockRejectedValue(Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' }))
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result.success).toBe(false)
    expect(planned()).toEqual(['xp2', 'xp3', 'xp4'])
    expect(fake.rows('xero_payments').filter(r => r.payment_type === 'installment').every(r => r.failure_reason == null)).toBe(true)
    expect(full()[0]).toMatchObject({ sync_status: 'cancelled' })
    expect(full()[0].failure_reason).toMatch(/declined/)
    expect(fake.rows('payments')[0].status).toBe('failed')
  })

  it('cancels the intent and restores the installments on requires_action', async () => {
    createIntent.mockResolvedValue({ id: 'pi_ra', status: 'requires_action' })
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result).toMatchObject({ success: false, error: 'Payment failed: requires_action' })
    expect(cancelIntent).toHaveBeenCalledWith('pi_ra')
    expect(planned()).toEqual(['xp2', 'xp3', 'xp4'])
    expect(full()[0].sync_status).toBe('cancelled')
    expect(fake.rows('payments')[0].status).toBe('failed')
  })

  it('leaves records alone when the outcome is unknown (non-card error) or still processing', async () => {
    createIntent.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }))
    await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(planned()).toEqual([])
    expect(full()[0].sync_status).toBe('staged')
  })
})
