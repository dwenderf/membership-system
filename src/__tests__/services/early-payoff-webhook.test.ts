/**
 * #466: the early payoff webhook finds the staged payoff row by its exact id, falls back to the
 * invoice only for older intents, and is a no-op on repeat deliveries.
 */
import { createFakeSupabase } from '@/__test-utils__/fake-supabase'

jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logXeroSync: jest.fn() }
}))

import { completeEarlyPayoffStagedPayment } from '@/lib/services/early-payoff-webhook'

const INV = 'inv-1'
const payoffRow = (id: string, sync_status: string, extra: Record<string, unknown> = {}) => ({
  id,
  xero_invoice_id: INV,
  payment_type: 'full',
  sync_status,
  staging_metadata: { early_payoff: true, user_id: 'user-1', ...extra }
})
const details = { paymentId: 'pay-1', chargeId: 'ch_1' }
const statusOf = (fake: ReturnType<typeof createFakeSupabase>, id: string) =>
  fake.rows('xero_payments').find(r => r.id === id)?.sync_status

describe('completeEarlyPayoffStagedPayment', () => {
  it('marks the row named in the intent metadata, even when the invoice has other staged payoff rows', async () => {
    const fake = createFakeSupabase({ xero_payments: [payoffRow('xp-a', 'staged'), payoffRow('xp-b', 'staged')] })
    const outcome = await completeEarlyPayoffStagedPayment(
      fake,
      { id: 'pi_1', metadata: { xeroStagingRecordId: INV, xeroStagedPaymentId: 'xp-b' } },
      details
    )
    expect(outcome).toEqual({ status: 'marked_pending', xeroPaymentId: 'xp-b' })
    expect(statusOf(fake, 'xp-b')).toBe('pending')
    expect(statusOf(fake, 'xp-a')).toBe('staged')
    const meta = fake.rows('xero_payments').find(r => r.id === 'xp-b')!.staging_metadata
    expect(meta).toMatchObject({ early_payoff: true, user_id: 'user-1', payment_id: 'pay-1', stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' })
  })

  it('is a no-op when the event is delivered again', async () => {
    const fake = createFakeSupabase({ xero_payments: [payoffRow('xp-a', 'staged')] })
    const pi = { id: 'pi_1', metadata: { xeroStagingRecordId: INV, xeroStagedPaymentId: 'xp-a' } }
    await completeEarlyPayoffStagedPayment(fake, pi, details)
    const again = await completeEarlyPayoffStagedPayment(fake, pi, details)
    expect(again).toEqual({ status: 'already_done', xeroPaymentId: 'xp-a' })
    expect(statusOf(fake, 'xp-a')).toBe('pending')
  })

  it('flags a payoff row that was rolled back although the charge went through', async () => {
    const fake = createFakeSupabase({ xero_payments: [payoffRow('xp-a', 'cancelled')] })
    const outcome = await completeEarlyPayoffStagedPayment(
      fake,
      { id: 'pi_1', metadata: { xeroStagingRecordId: INV, xeroStagedPaymentId: 'xp-a' } },
      details
    )
    expect(outcome).toEqual({ status: 'needs_review', xeroPaymentId: 'xp-a', syncStatus: 'cancelled' })
    expect(statusOf(fake, 'xp-a')).toBe('cancelled')
  })

  it('returns not_found instead of throwing when the named row does not exist', async () => {
    const fake = createFakeSupabase({ xero_payments: [] })
    const outcome = await completeEarlyPayoffStagedPayment(
      fake,
      { id: 'pi_1', metadata: { xeroStagingRecordId: INV, xeroStagedPaymentId: 'missing' } },
      details
    )
    expect(outcome).toEqual({ status: 'not_found' })
  })

  it('throws on a database error so Stripe retries', async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }) }) }) }) }
    await expect(
      completeEarlyPayoffStagedPayment(failing, { id: 'pi_1', metadata: { xeroStagedPaymentId: 'xp-a' } }, details)
    ).rejects.toEqual({ message: 'connection reset' })
  })

  describe('older intents without xeroStagedPaymentId', () => {
    it('marks the single staged payoff row on the invoice', async () => {
      const fake = createFakeSupabase({ xero_payments: [payoffRow('xp-old', 'cancelled'), payoffRow('xp-a', 'staged')] })
      const outcome = await completeEarlyPayoffStagedPayment(fake, { id: 'pi_1', metadata: { xeroStagingRecordId: INV } }, details)
      expect(outcome).toEqual({ status: 'marked_pending', xeroPaymentId: 'xp-a' })
      expect(statusOf(fake, 'xp-old')).toBe('cancelled')
    })

    it('refuses to guess when more than one staged payoff row matches', async () => {
      const fake = createFakeSupabase({ xero_payments: [payoffRow('xp-a', 'staged'), payoffRow('xp-b', 'staged')] })
      const outcome = await completeEarlyPayoffStagedPayment(fake, { id: 'pi_1', metadata: { xeroStagingRecordId: INV } }, details)
      expect(outcome).toEqual({ status: 'ambiguous', candidateIds: ['xp-a', 'xp-b'] })
      expect(statusOf(fake, 'xp-a')).toBe('staged')
      expect(statusOf(fake, 'xp-b')).toBe('staged')
    })

    it('recognises a row this intent already handled, even if another staged row exists', async () => {
      const fake = createFakeSupabase({
        xero_payments: [payoffRow('xp-a', 'pending', { stripe_payment_intent_id: 'pi_1' }), payoffRow('xp-b', 'staged')]
      })
      const outcome = await completeEarlyPayoffStagedPayment(fake, { id: 'pi_1', metadata: { xeroStagingRecordId: INV } }, details)
      expect(outcome).toEqual({ status: 'already_done', xeroPaymentId: 'xp-a' })
      expect(statusOf(fake, 'xp-b')).toBe('staged')
    })
  })
})
