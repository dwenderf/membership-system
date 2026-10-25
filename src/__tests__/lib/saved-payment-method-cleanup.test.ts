const logPaymentProcessing = jest.fn()
jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: (...a: unknown[]) => logPaymentProcessing(...a), logSystem: jest.fn() } }))
const stageEmail = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: (...a: unknown[]) => stageEmail(...a) } }))

import { clearSavedPaymentMethod } from '@/lib/services/saved-payment-method-cleanup'

import { makeFakeDb } from '@/test-helpers/fake-users-db'

describe('clearSavedPaymentMethod', () => {
  beforeEach(() => { stageEmail.mockClear(); process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID = 'tmpl' })

  it('clears the card, deletes alternates and stages exactly one email across route + webhook', async () => {
    const { state, supabase } = makeFakeDb('pm_1')
    const first = await clearSavedPaymentMethod({ supabase, paymentMethodId: 'pm_1', userId: 'user-1', last4: '4242', source: 'remove-route' })
    const second = await clearSavedPaymentMethod({ supabase, paymentMethodId: 'pm_1', last4: '4242', source: 'webhook' })
    expect(first.cleared).toBe(true)
    expect(second.cleared).toBe(false)
    expect(state.user.stripe_payment_method_id).toBeNull()
    expect(state.alternatesDeleted).toBe(1)
    expect(stageEmail).toHaveBeenCalledTimes(1)
    expect(stageEmail.mock.calls[0][0]).toMatchObject({ event_type: 'payment_method.removed', subject: 'Payment Method Removed', email_data: { paymentMethod: '****4242' } })
  })

  it('does not touch the current card when a different card is detached', async () => {
    const { state, supabase } = makeFakeDb('pm_current')
    const r = await clearSavedPaymentMethod({ supabase, paymentMethodId: 'pm_old', source: 'webhook' })
    expect(r.cleared).toBe(false)
    expect(state.user.stripe_payment_method_id).toBe('pm_current')
    expect(stageEmail).not.toHaveBeenCalled()
  })

  // Models the conditional UPDATE as atomic (as Postgres row locking makes it)
  it('route and webhook racing concurrently stage exactly one email', async () => {
    const { state, supabase } = makeFakeDb('pm_1')
    const results = await Promise.all([
      clearSavedPaymentMethod({ supabase, paymentMethodId: 'pm_1', userId: 'user-1', source: 'remove-route' }),
      clearSavedPaymentMethod({ supabase, paymentMethodId: 'pm_1', source: 'webhook' }),
    ])
    expect(results.filter(r => r.cleared)).toHaveLength(1)
    expect(state.updates).toBe(1)
    expect(stageEmail).toHaveBeenCalledTimes(1)
  })

  it('logs a warning when email staging fails after the clear', async () => {
    stageEmail.mockResolvedValueOnce(false)
    const { supabase } = makeFakeDb('pm_1')
    const r = await clearSavedPaymentMethod({ supabase, paymentMethodId: 'pm_1', userId: 'user-1', source: 'remove-route' })
    expect(r.cleared).toBe(true)
    expect(logPaymentProcessing).toHaveBeenCalledWith('payment-method-removed-email-staging-failed', expect.any(String), expect.any(Object), 'warn')
  })
})
