jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: jest.fn(), logSystem: jest.fn() } }))
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
})
