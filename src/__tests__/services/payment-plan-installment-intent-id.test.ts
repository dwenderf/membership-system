/**
 * #382: each installment's xero_payments row must keep its own Stripe PaymentIntent id
 * after a successful charge, not revert to the checkout's original one.
 */

const updates: Array<Record<string, unknown>> = []
const stagedMetadata = { stripe_payment_intent_id: 'pi_checkout', user_registration_id: 'ur1' }

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: () => ({
    paymentIntents: { create: async () => ({ id: 'pi_installment_2', status: 'succeeded' }) }
  })
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logBatchProcessing: jest.fn() }
}))
jest.mock('@/lib/payment-method-utils', () => ({ userHasValidPaymentMethod: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.insert = () => chain
      chain.update = (v: Record<string, unknown>) => {
        if (table === 'xero_payments') updates.push(v)
        return chain
      }
      chain.eq = () => chain
      chain.single = () => {
        if (table === 'xero_payments') {
          return Promise.resolve({
            data: {
              id: 'xp2',
              xero_invoice_id: 'inv1',
              installment_number: 2,
              amount_paid: 2500,
              attempt_count: 0,
              staging_metadata: stagedMetadata,
              xero_invoice: {
                id: 'inv1',
                user_registrations: [{ user_id: 'u1', registration: null }]
              }
            },
            error: null
          })
        }
        if (table === 'users') {
          return Promise.resolve({
            data: { id: 'u1', stripe_payment_method_id: 'pm', stripe_customer_id: 'cus', email: 'a@b.c' },
            error: null
          })
        }
        return Promise.resolve({ data: { id: 'pay1' }, error: null })
      }
      return chain
    }
  })
}))

import { PaymentPlanService } from '@/lib/services/payment-plan-service'

describe('processPaymentPlanTransaction staging_metadata', () => {
  it('keeps the installment’s own stripe_payment_intent_id after success', async () => {
    updates.length = 0
    const result = await PaymentPlanService.processPaymentPlanTransaction('xp2')
    expect(result.success).toBe(true)

    const final = updates.find(u => u.sync_status === 'pending') as { staging_metadata: Record<string, unknown> }
    expect(final.staging_metadata.stripe_payment_intent_id).toBe('pi_installment_2')
    expect(final.staging_metadata.payment_id).toBe('pay1')
  })
})
