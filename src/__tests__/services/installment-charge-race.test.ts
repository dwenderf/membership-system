/**
 * #461: an installment charge claims its row (planned -> processing only if still planned), skips
 * an invoice with a live early payoff, uses a per-attempt idempotency key, and only goes back to
 * planned when no charge can have happened. The webhook settles intents the charge path didn't.
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

import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { completeInstallmentCharge, releaseFailedInstallmentCharge, installmentIdempotencyKey } from '@/lib/services/installment-charge'

const INV = 'inv-1'
const USER = 'user-1'
const invoiceJoin = { id: INV, user_registrations: [{ user_id: USER, registration: { name: 'Spring', season: { name: 'Squall' } } }] }
const installment = (id: string, n: number, sync_status: string, extra: Record<string, unknown> = {}) => ({
  id,
  xero_invoice_id: INV,
  payment_type: 'installment',
  installment_number: n,
  amount_paid: 3125,
  attempt_count: 0,
  last_attempt_at: null,
  sync_status,
  staging_metadata: {},
  xero_invoice: invoiceJoin,
  ...extra
})

beforeEach(() => {
  createIntent.mockReset()
  cancelIntent.mockReset()
  fake = createFakeSupabase({
    users: [{ id: USER, stripe_payment_method_id: 'pm_1', stripe_customer_id: 'cus_1', email: 'd@example.com' }],
    xero_invoices: [{ id: INV, user_registrations: [{ registration: { name: 'Spring', season: { name: 'Squall' } } }] }],
    xero_payments: [
      installment('xp1', 1, 'synced'),
      installment('xp2', 2, 'planned'),
      installment('xp3', 3, 'planned'),
      installment('xp4', 4, 'planned')
    ],
    payments: []
  })
})

const row = (id: string) => fake.rows('xero_payments').find(r => r.id === id)!
const succeeded = (id: string, attempt = '1') => ({ id, status: 'succeeded', amount: 3125, metadata: { xeroPaymentId: 'xp2', attemptNumber: attempt, userId: USER } })

describe('processPaymentPlanTransaction (#461)', () => {
  it('charges with a per-attempt idempotency key and records the payment once', async () => {
    createIntent.mockResolvedValue(succeeded('pi_1'))
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')

    expect(result.success).toBe(true)
    const [params, options] = createIntent.mock.calls[0]
    expect(options).toEqual({ idempotencyKey: installmentIdempotencyKey('xp2', 1) })
    expect(params.metadata).toMatchObject({ xeroPaymentId: 'xp2', attemptNumber: '1', purpose: 'payment_plan_installment' })
    expect(row('xp2').sync_status).toBe('pending')
    expect(row('xp2').attempt_count).toBe(1)
    expect(fake.rows('payments')).toHaveLength(1)
  })

  it('skips a row that is no longer planned without charging', async () => {
    row('xp2').sync_status = 'cancelled'
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, skipped: 'not_planned' })
    expect(createIntent).not.toHaveBeenCalled()
  })

  it('does not charge when an early payoff cancels the row between the read and the claim', async () => {
    const realFrom = fake.from
    fake.from = (name: string) => {
      const q = realFrom(name)
      if (name !== 'xero_payments') return q
      const realUpdate = q.update
      q.update = (v: Record<string, unknown>) => {
        // the payoff's cancel lands just before the claim runs
        if (v.sync_status === 'processing') row('xp2').sync_status = 'cancelled'
        return realUpdate(v)
      }
      return q
    }
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, skipped: 'not_planned' })
    expect(createIntent).not.toHaveBeenCalled()
    expect(row('xp2').sync_status).toBe('cancelled')
  })

  it('only one of two concurrent runs charges the installment', async () => {
    createIntent.mockResolvedValue(succeeded('pi_1'))
    const [a, b] = await Promise.all([
      PaymentPlanService.processPaymentPlanTransaction('xp2'),
      PaymentPlanService.processPaymentPlanTransaction('xp2')
    ])
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1)
    expect([a.skipped, b.skipped]).toContain('not_planned')
    expect(createIntent).toHaveBeenCalledTimes(1)
    expect(fake.rows('payments')).toHaveLength(1)
  })

  it('skips an invoice with a live early payoff and puts the row back as it was', async () => {
    row('xp2').attempt_count = 2
    row('xp2').last_attempt_at = '2026-11-01T00:00:00Z'
    fake.rows('xero_payments').push({ id: 'full-1', xero_invoice_id: INV, payment_type: 'full', sync_status: 'staged', staging_metadata: { early_payoff: true } })

    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, skipped: 'payoff_in_progress' })
    expect(createIntent).not.toHaveBeenCalled()
    expect(row('xp2')).toMatchObject({ sync_status: 'planned', attempt_count: 2, last_attempt_at: '2026-11-01T00:00:00Z' })
  })

  it('ignores a rolled-back early payoff row', async () => {
    fake.rows('xero_payments').push({ id: 'full-1', xero_invoice_id: INV, payment_type: 'full', sync_status: 'cancelled', staging_metadata: { early_payoff: true } })
    createIntent.mockResolvedValue(succeeded('pi_1'))
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result.success).toBe(true)
  })

  it('leaves a processing intent in processing for the webhook', async () => {
    createIntent.mockResolvedValue({ id: 'pi_1', status: 'processing', amount: 3125, metadata: {} })
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, inFlight: true })
    expect(row('xp2').sync_status).toBe('processing')
    expect(row('xp2').staging_metadata.stripe_payment_intent_id).toBe('pi_1')
  })

  it('puts a declined installment back to planned for retry', async () => {
    createIntent.mockRejectedValue(Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' }))
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, error: 'Your card was declined.' })
    expect(result.inFlight).toBeUndefined()
    expect(row('xp2')).toMatchObject({ sync_status: 'planned', failure_reason: 'Your card was declined.', attempt_count: 1 })
  })

  it('a slow decline leaves a newer attempt alone', async () => {
    createIntent.mockImplementation(async () => {
      // While the decline is in transit, a webhook releases attempt 1 and a retry claims attempt 2.
      Object.assign(row('xp2'), { sync_status: 'processing', attempt_count: 2 })
      throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' })
    })
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false })
    expect(row('xp2')).toMatchObject({ sync_status: 'processing', attempt_count: 2 })
  })

  it.each([
    'StripeInvalidRequestError',
    'StripeAuthenticationError',
    'StripePermissionError'
  ])('puts a %s installment back to planned for retry', async (type) => {
    createIntent.mockRejectedValue(Object.assign(new Error('stripe request rejected'), { type }))
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, error: 'stripe request rejected' })
    expect(result.inFlight).toBeUndefined()
    expect(row('xp2')).toMatchObject({
      sync_status: 'planned',
      failure_reason: 'stripe request rejected',
      attempt_count: 1
    })
  })

  it.each([
    'StripeConnectionError',
    'StripeAPIError',
    'StripeIdempotencyError',
    'StripeRateLimitError'
  ])('leaves the row processing when the Stripe call fails with %s', async (type) => {
    createIntent.mockRejectedValue(Object.assign(new Error('stripe outcome unknown'), { type }))
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, inFlight: true })
    expect(row('xp2').sync_status).toBe('processing')
  })

  it('puts a requires_action intent back to planned', async () => {
    createIntent.mockResolvedValue({ id: 'pi_1', status: 'requires_action', amount: 3125, metadata: {} })
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result).toMatchObject({ success: false, error: 'Payment status: requires_action' })
    expect(row('xp2').sync_status).toBe('planned')
  })
})

describe('early payoff vs an installment charge (#461)', () => {
  it('stops the payoff and restores the plan when an installment was claimed after the payoff read it', async () => {
    const realFrom = fake.from
    fake.from = (name: string) => {
      const q = realFrom(name)
      if (name !== 'xero_payments') return q
      const realUpdate = q.update
      q.update = (v: Record<string, unknown>) => {
        // the cron claims xp2 just before the payoff's cancel runs
        if (v.failure_reason === 'Superseded by early payoff payment') row('xp2').sync_status = 'processing'
        return realUpdate(v)
      }
      return q
    }
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result.success).toBe(false)
    expect(createIntent).not.toHaveBeenCalled()
    expect(row('xp3').sync_status).toBe('planned')
    expect(row('xp4').sync_status).toBe('planned')
    const full = fake.rows('xero_payments').filter(r => r.payment_type === 'full')
    expect(full.map(r => r.sync_status)).toEqual(['cancelled'])
  })

  it('stops the payoff while an installment it did not read is being charged', async () => {
    // The cron claimed xp2 before the payoff read the plan, so the payoff's balance leaves it out.
    row('xp2').sync_status = 'processing'
    row('xp2').attempt_count = 1
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('being processed') })
    expect(createIntent).not.toHaveBeenCalled()
    expect(row('xp2').sync_status).toBe('processing')
    expect(row('xp3').sync_status).toBe('planned')
    expect(row('xp4').sync_status).toBe('planned')
    const full = fake.rows('xero_payments').filter(r => r.payment_type === 'full')
    expect(full.map(r => r.sync_status)).toEqual(['cancelled'])
  })

  it('stops the payoff when an installment it did not read was put back to planned meanwhile', async () => {
    // The cron claimed xp2 before the payoff read the plan, then saw the payoff and released xp2.
    row('xp2').sync_status = 'processing'
    const realFrom = fake.from
    fake.from = (name: string) => {
      const q = realFrom(name)
      if (name !== 'xero_payments') return q
      const realUpdate = q.update
      q.update = (v: Record<string, unknown>) => {
        if (v.failure_reason === 'Superseded by early payoff payment') row('xp2').sync_status = 'planned'
        return realUpdate(v)
      }
      return q
    }
    const result = await PaymentPlanService.processEarlyPayoff(INV, USER)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('being processed') })
    expect(createIntent).not.toHaveBeenCalled()
    expect(['xp2', 'xp3', 'xp4'].map(id => row(id).sync_status)).toEqual(['planned', 'planned', 'planned'])
    const full = fake.rows('xero_payments').filter(r => r.payment_type === 'full')
    expect(full.map(r => r.sync_status)).toEqual(['cancelled'])
  })
})

describe('completeInstallmentCharge (webhook backstop, #461)', () => {
  it('settles a processing row once, even when called twice', async () => {
    row('xp2').sync_status = 'processing'
    row('xp2').attempt_count = 1
    row('xp2').staging_metadata = { stripe_payment_intent_id: 'pi_1' }
    const pi = succeeded('pi_1')
    const [a, b] = await Promise.all([
      completeInstallmentCharge(fake, 'xp2', pi, USER),
      completeInstallmentCharge(fake, 'xp2', pi, USER)
    ])
    expect([a.status, b.status].sort()).toEqual(['already_done', 'completed'])
    expect(fake.rows('payments')).toHaveLength(1)
    expect(row('xp2').sync_status).toBe('pending')
    expect(row('xp2').staging_metadata.payment_id).toBe(fake.rows('payments')[0].id)
  })

  it('is a no-op for a row already settled by this intent', async () => {
    row('xp2').sync_status = 'pending'
    row('xp2').staging_metadata = { stripe_payment_intent_id: 'pi_1' }
    expect(await completeInstallmentCharge(fake, 'xp2', succeeded('pi_1'), USER)).toEqual({ status: 'already_done' })
    expect(fake.rows('payments')).toHaveLength(0)
  })

  it('refuses an intent from an earlier attempt', async () => {
    row('xp2').sync_status = 'processing'
    row('xp2').attempt_count = 2
    expect(await completeInstallmentCharge(fake, 'xp2', succeeded('pi_old', '1'), USER)).toEqual({ status: 'not_processing', syncStatus: 'processing' })
    expect(row('xp2').sync_status).toBe('processing')
  })

  it('reports a row that is not waiting for a charge', async () => {
    expect(await completeInstallmentCharge(fake, 'xp2', succeeded('pi_1'), USER)).toEqual({ status: 'not_processing', syncStatus: 'planned' })
  })
})

describe('releaseFailedInstallmentCharge (#461)', () => {
  const failed = (id: string, attempt = '1') => ({ id, metadata: { xeroPaymentId: 'xp2', attemptNumber: attempt }, last_payment_error: { message: 'Bank debit failed' } }) as never

  it('puts a processing row that failed later back to planned', async () => {
    row('xp2').sync_status = 'processing'
    row('xp2').attempt_count = 1
    row('xp2').staging_metadata = { stripe_payment_intent_id: 'pi_1' }
    expect(await releaseFailedInstallmentCharge(fake, 'xp2', failed('pi_1'))).toEqual({ status: 'released' })
    expect(row('xp2')).toMatchObject({ sync_status: 'planned', failure_reason: 'Bank debit failed' })
  })

  it('leaves a newer attempt alone', async () => {
    row('xp2').sync_status = 'processing'
    row('xp2').attempt_count = 2
    row('xp2').staging_metadata = { stripe_payment_intent_id: 'pi_2' }
    expect(await releaseFailedInstallmentCharge(fake, 'xp2', failed('pi_1', '1'))).toEqual({ status: 'ignored', reason: 'other_attempt' })
    expect(row('xp2').sync_status).toBe('processing')
  })

  it('leaves a newer attempt alone when it is claimed between the read and the update', async () => {
    row('xp2').sync_status = 'processing'
    row('xp2').attempt_count = 1
    const realFrom = fake.from
    const racing = {
      from: (name: string) => {
        const q = realFrom(name)
        const realUpdate = q.update
        q.update = (v: Record<string, unknown>) => {
          // another delivery released attempt 1 and the cron claimed attempt 2 meanwhile
          row('xp2').attempt_count = 2
          return realUpdate(v)
        }
        return q
      }
    }
    expect(await releaseFailedInstallmentCharge(racing, 'xp2', failed('pi_1', '1'))).toEqual({ status: 'ignored', reason: 'no_longer_processing' })
    expect(row('xp2')).toMatchObject({ sync_status: 'processing', attempt_count: 2 })
  })

  it('ignores a row the charge path already put back', async () => {
    expect(await releaseFailedInstallmentCharge(fake, 'xp2', failed('pi_1'))).toEqual({ status: 'ignored', reason: 'status planned' })
  })
})
