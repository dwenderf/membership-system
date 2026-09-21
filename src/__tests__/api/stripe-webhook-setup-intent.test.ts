/**
 * Regression test for issue #384: the `setup_intent.succeeded` webhook handler
 * must persist `stripe_customer_id`, not just `stripe_payment_method_id`.
 *
 * Without this, a user whose client never completes `/api/confirm-setup-intent`
 * (closed tab, dropped network) but whose Stripe webhook still fires is left
 * with a saved payment method and no customer ID.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock'

jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: jest.fn()
}))

jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logSystem: jest.fn(),
    logPaymentProcessing: jest.fn()
  }
}))

jest.mock('@/lib/membership-utils', () => ({
  calculateMembershipStartDate: jest.fn(),
  calculateMembershipEndDate: jest.fn()
}))

jest.mock('@/lib/xero/invoices', () => ({
  deleteXeroDraftInvoice: jest.fn()
}))

jest.mock('@/lib/payment-completion-processor', () => ({
  paymentProcessor: {
    processPaymentCompletion: jest.fn()
  }
}))

jest.mock('@/lib/email/refund-notification', () => ({
  stageRefundNotificationEmail: jest.fn()
}))

import { POST } from '@/app/api/stripe-webhook/route'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { NextRequest } from 'next/server'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: '{}'
  })
}

describe('POST /api/stripe-webhook - setup_intent.succeeded', () => {
  let updateMock: jest.Mock
  let eqMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    eqMock = jest.fn().mockResolvedValue({ error: null })
    updateMock = jest.fn().mockReturnValue({ eq: eqMock })

    ;(createAdminClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({ update: updateMock })
    })
  })

  function mockSetupIntentEvent(setupIntent: Record<string, unknown>) {
    ;(getStripe as jest.Mock).mockReturnValue({
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          type: 'setup_intent.succeeded',
          data: { object: setupIntent }
        })
      }
    })
  }

  it('persists stripe_customer_id from the setup intent, not just the payment method', async () => {
    mockSetupIntentEvent({
      id: 'seti_123',
      payment_method: 'pm_123',
      customer: 'cus_123',
      metadata: { userId: 'user-123' }
    })

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_payment_method_id: 'pm_123',
        stripe_customer_id: 'cus_123',
        setup_intent_status: 'succeeded'
      })
    )
    expect(eqMock).toHaveBeenCalledWith('id', 'user-123')
  })

  it('handles an expanded (object) customer field the same as a plain ID string', async () => {
    mockSetupIntentEvent({
      id: 'seti_456',
      payment_method: 'pm_456',
      customer: { id: 'cus_456' },
      metadata: { userId: 'user-456' }
    })

    await POST(makeRequest())

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_customer_id: 'cus_456' })
    )
  })

  it('still updates the payment method when no customer is present on the setup intent', async () => {
    mockSetupIntentEvent({
      id: 'seti_789',
      payment_method: 'pm_789',
      customer: null,
      metadata: { userId: 'user-789' }
    })

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_payment_method_id: 'pm_789' })
    )
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ stripe_customer_id: expect.anything() })
    )
  })
})
