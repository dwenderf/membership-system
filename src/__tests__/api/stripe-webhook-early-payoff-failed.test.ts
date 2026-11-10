process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock'

import { createFakeSupabase } from '@/__test-utils__/fake-supabase'

let fake: ReturnType<typeof createFakeSupabase>

jest.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fake }))
jest.mock('@/lib/stripe/server-client', () => ({ getStripe: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logSystem: jest.fn(), logPaymentProcessing: jest.fn(), logXeroSync: jest.fn() }
}))
jest.mock('@/lib/membership-utils', () => ({ calculateMembershipStartDate: jest.fn(), calculateMembershipEndDate: jest.fn() }))
jest.mock('@/lib/xero/invoices', () => ({ deleteXeroDraftInvoice: jest.fn() }))
jest.mock('@/lib/payment-completion-processor', () => ({ paymentProcessor: { processPaymentCompletion: jest.fn() } }))
jest.mock('@/lib/email/refund-notification', () => ({ stageRefundNotificationEmail: jest.fn() }))
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: jest.fn() } }))

import { POST } from '@/app/api/stripe-webhook/route'
import { getStripe } from '@/lib/stripe/server-client'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { NextRequest } from 'next/server'

/** #462: payment_intent.payment_failed for an early payoff rolls the plan back instead of falling through. */
function send(object: Record<string, unknown>) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: { constructEvent: jest.fn().mockReturnValue({ id: 'evt_1', type: 'payment_intent.payment_failed', data: { object } }) }
  })
  return POST(new NextRequest('http://localhost/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }))
}

const intent = {
  id: 'pi_1',
  object: 'payment_intent',
  metadata: { purpose: 'payment_plan_early_payoff', userId: 'u1', xeroStagingRecordId: 'inv-1', xeroStagedPaymentId: 'xp-a', paymentId: 'pay-1' },
  last_payment_error: { message: 'insufficient funds' }
}

describe('stripe webhook: failed early payoff (#462)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fake = createFakeSupabase({
      xero_payments: [
        { id: 'i2', xero_invoice_id: 'inv-1', payment_type: 'installment', sync_status: 'cancelled', failure_reason: 'Superseded by early payoff payment', staging_metadata: {} },
        { id: 'xp-a', xero_invoice_id: 'inv-1', payment_type: 'full', sync_status: 'staged', staging_metadata: { early_payoff: true } }
      ],
      payments: [{ id: 'pay-1', status: 'pending' }]
    })
  })

  it('rolls the plan back and skips the membership/registration failure handling', async () => {
    const res = await send(intent)
    expect(res.status).toBe(200)
    const rows = fake.rows('xero_payments')
    expect(rows.find(r => r.id === 'xp-a')!.sync_status).toBe('cancelled')
    expect(rows.find(r => r.id === 'i2')!.sync_status).toBe('planned')
    expect(fake.rows('payments')[0].status).toBe('failed')
    expect(paymentProcessor.processPaymentCompletion).not.toHaveBeenCalled()
  })
})
