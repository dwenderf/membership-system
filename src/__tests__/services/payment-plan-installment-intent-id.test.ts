/**
 * #382: each installment's xero_payments row must keep its own Stripe PaymentIntent id
 * after a successful charge, not revert to the checkout's original one.
 */
import { createFakeSupabase } from '@/__test-utils__/fake-supabase'

let fake: ReturnType<typeof createFakeSupabase>

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: () => ({
    paymentIntents: { create: async () => ({ id: 'pi_installment_2', status: 'succeeded', amount: 2500, metadata: { attemptNumber: '1' } }) }
  })
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logBatchProcessing: jest.fn() }
}))
jest.mock('@/lib/payment-method-utils', () => ({ userHasValidPaymentMethod: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createAdminClient: () => fake }))

import { PaymentPlanService } from '@/lib/services/payment-plan-service'

describe('processPaymentPlanTransaction staging_metadata', () => {
  it('keeps the installment’s own stripe_payment_intent_id after success', async () => {
    fake = createFakeSupabase({
      users: [{ id: 'u1', stripe_payment_method_id: 'pm', stripe_customer_id: 'cus', email: 'a@b.c' }],
      xero_payments: [{
        id: 'xp2',
        xero_invoice_id: 'inv1',
        payment_type: 'installment',
        installment_number: 2,
        amount_paid: 2500,
        attempt_count: 0,
        sync_status: 'planned',
        staging_metadata: { stripe_payment_intent_id: 'pi_checkout', user_registration_id: 'ur1' },
        xero_invoice: { id: 'inv1', user_registrations: [{ user_id: 'u1', registration: null }] }
      }],
      payments: []
    })

    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result.success).toBe(true)

    const row = fake.rows('xero_payments')[0]
    expect(row.sync_status).toBe('pending')
    expect(row.staging_metadata.stripe_payment_intent_id).toBe('pi_installment_2')
    expect(row.staging_metadata.payment_id).toBe(fake.rows('payments')[0].id)
    expect(row.staging_metadata.user_registration_id).toBe('ur1')
  })
})
