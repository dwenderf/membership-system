/**
 * #462: a payoff PaymentIntent that returned 'processing' and later failed is rolled back by the
 * payment_intent.payment_failed webhook, without undoing a newer payoff or repeating work.
 */
import { createFakeSupabase } from '@/__test-utils__/fake-supabase'

jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logXeroSync: jest.fn() }
}))

import { rollbackFailedEarlyPayoff } from '@/lib/services/early-payoff-webhook'

const INV = 'inv-1'
const SUPERSEDED = 'Superseded by early payoff payment'
const payoffRow = (id: string, sync_status: string) => ({
  id,
  xero_invoice_id: INV,
  payment_type: 'full',
  sync_status,
  staging_metadata: { early_payoff: true, user_id: 'user-1' }
})
const installment = (id: string, sync_status: string, failure_reason: string | null) => ({
  id,
  xero_invoice_id: INV,
  payment_type: 'installment',
  sync_status,
  failure_reason,
  staging_metadata: {}
})
const failedIntent = (stagedId?: string) => ({
  id: 'pi_1',
  metadata: { purpose: 'payment_plan_early_payoff', xeroStagingRecordId: INV, paymentId: 'pay-1', ...(stagedId ? { xeroStagedPaymentId: stagedId } : {}) },
  last_payment_error: { message: 'Your card was declined.' } as never
})
const row = (fake: ReturnType<typeof createFakeSupabase>, table: string, id: string) => fake.rows(table).find(r => r.id === id)!

function plan(stagedStatus = 'staged', extraRows: Record<string, unknown>[] = []) {
  return createFakeSupabase({
    xero_payments: [
      installment('i1', 'synced', null),
      installment('i2', 'cancelled', SUPERSEDED),
      installment('i3', 'cancelled', SUPERSEDED),
      payoffRow('xp-a', stagedStatus),
      ...extraRows
    ],
    payments: [{ id: 'pay-1', status: 'pending' }]
  })
}

describe('rollbackFailedEarlyPayoff', () => {
  it('cancels the staged payoff, restores the superseded installments and fails the payment', async () => {
    const fake = plan()
    const outcome = await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))

    expect(outcome).toEqual({ status: 'rolled_back', xeroPaymentId: 'xp-a', restoredInstallments: 2 })
    expect(row(fake, 'xero_payments', 'xp-a').sync_status).toBe('cancelled')
    expect(row(fake, 'xero_payments', 'xp-a').failure_reason).toBe('Early payoff failed: Your card was declined.')
    expect(row(fake, 'xero_payments', 'i2')).toMatchObject({ sync_status: 'planned', failure_reason: null })
    expect(row(fake, 'xero_payments', 'i3')).toMatchObject({ sync_status: 'planned', failure_reason: null })
    expect(row(fake, 'xero_payments', 'i1').sync_status).toBe('synced')
    expect(row(fake, 'payments', 'pay-1').status).toBe('failed')
  })

  it('is a no-op when the event is delivered again', async () => {
    const fake = plan()
    await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))
    const again = await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))
    expect(again).toEqual({ status: 'already_handled' })
    expect(row(fake, 'xero_payments', 'i2').sync_status).toBe('planned')
  })

  it('a repeat delivery leaves alone installments that a newer payoff has cancelled since', async () => {
    const fake = plan()
    await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))
    // A newer payoff starts: its staged row, and the restored installments superseded again.
    fake.rows('xero_payments').push(payoffRow('xp-b', 'staged'))
    for (const id of ['i2', 'i3']) Object.assign(row(fake, 'xero_payments', id), { sync_status: 'cancelled', failure_reason: SUPERSEDED })

    expect(await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))).toEqual({ status: 'already_handled' })
    expect(row(fake, 'xero_payments', 'i2').sync_status).toBe('cancelled')
    expect(row(fake, 'xero_payments', 'xp-b').sync_status).toBe('staged')
  })

  it('a repeat delivery for an older intent does not cancel a newer payoff', async () => {
    const fake = plan()
    await rollbackFailedEarlyPayoff(fake, failedIntent())
    fake.rows('xero_payments').push(payoffRow('xp-b', 'staged'))

    expect(await rollbackFailedEarlyPayoff(fake, failedIntent())).toEqual({ status: 'already_handled' })
    expect(row(fake, 'xero_payments', 'xp-b').sync_status).toBe('staged')
  })

  it('finishes a rollback that a failed earlier delivery left half done', async () => {
    // Staged row already cancelled, installments still superseded (e.g. the restore errored and Stripe retried).
    const fake = plan('cancelled')
    const outcome = await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))
    expect(outcome).toEqual({ status: 'already_rolled_back', xeroPaymentId: 'xp-a', restoredInstallments: 2 })
    expect(row(fake, 'xero_payments', 'i2').sync_status).toBe('planned')
    expect(row(fake, 'payments', 'pay-1').status).toBe('failed')
  })

  it('leaves the installments alone when a newer payoff on the invoice is live', async () => {
    const fake = plan('cancelled', [payoffRow('xp-b', 'staged')])
    const outcome = await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))
    expect(outcome).toEqual({ status: 'already_rolled_back', xeroPaymentId: 'xp-a', restoredInstallments: 0 })
    expect(row(fake, 'xero_payments', 'i2').sync_status).toBe('cancelled')
    expect(row(fake, 'xero_payments', 'xp-b').sync_status).toBe('staged')
  })

  it('does not touch a payoff that was already recorded as paid', async () => {
    const fake = plan('pending')
    const outcome = await rollbackFailedEarlyPayoff(fake, failedIntent('xp-a'))
    expect(outcome).toEqual({ status: 'needs_review', xeroPaymentId: 'xp-a', syncStatus: 'pending' })
    expect(row(fake, 'xero_payments', 'xp-a').sync_status).toBe('pending')
    expect(row(fake, 'xero_payments', 'i2').sync_status).toBe('cancelled')
  })

  it('finds the staged row by invoice for older intents, but only when there is exactly one', async () => {
    const one = plan()
    expect(await rollbackFailedEarlyPayoff(one, failedIntent())).toEqual({ status: 'rolled_back', xeroPaymentId: 'xp-a', restoredInstallments: 2 })

    const two = plan('staged', [payoffRow('xp-b', 'staged')])
    expect(await rollbackFailedEarlyPayoff(two, failedIntent())).toEqual({ status: 'ambiguous', candidateIds: ['xp-a', 'xp-b'] })
    expect(row(two, 'xero_payments', 'i2').sync_status).toBe('cancelled')
  })

  it('finishes an older intent rollback that a failed earlier delivery left half done', async () => {
    // No xeroStagedPaymentId; the staged row was cancelled but the restore errored, so Stripe retried.
    const fake = plan('cancelled')
    expect(await rollbackFailedEarlyPayoff(fake, failedIntent())).toEqual({ status: 'not_found', restoredInstallments: 2 })
    expect(row(fake, 'xero_payments', 'i2').sync_status).toBe('planned')
    expect(row(fake, 'payments', 'pay-1').status).toBe('failed')
  })

  it('still marks the payment failed when no payoff row matches', async () => {
    const fake = createFakeSupabase({ xero_payments: [], payments: [{ id: 'pay-1', status: 'pending' }] })
    expect(await rollbackFailedEarlyPayoff(fake, failedIntent('missing'))).toEqual({ status: 'not_found', restoredInstallments: 0 })
    expect(row(fake, 'payments', 'pay-1').status).toBe('failed')
  })

  it('throws on a database error so Stripe retries', async () => {
    const fake = plan()
    const broken = {
      from: (table: string) => (table === 'payments'
        ? { select: (cols: string) => fake.from(table).select(cols), update: () => ({ eq: () => ({ eq: async () => ({ error: { message: 'db down' } }) }) }) }
        : fake.from(table))
    }
    await expect(rollbackFailedEarlyPayoff(broken, failedIntent('xp-a'))).rejects.toEqual({ message: 'db down' })
  })
})
