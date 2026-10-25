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

const stageEmail = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: (...a: unknown[]) => stageEmail(...a) } }))

import { POST } from '@/app/api/stripe-webhook/route'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { NextRequest } from 'next/server'
import { makeFakeDb } from '@/test-helpers/fake-users-db'
import { clearSavedPaymentMethod } from '@/lib/services/saved-payment-method-cleanup'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: '{}'
  })
}

function mockDetachedEvent() {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        id: 'evt_1',
        type: 'payment_method.detached',
        data: { object: { id: 'pm_1', customer: null, card: { last4: '4242' } }, previous_attributes: { customer: 'cus_1' } }
      })
    }
  })
}

describe('POST /api/stripe-webhook - payment_method.detached', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID = 'tmpl' })

  it('is a no-op (200, no duplicate email) when the remove route already cleared the DB', async () => {
    const db = makeFakeDb('pm_1')
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    await clearSavedPaymentMethod({ supabase: db.supabase, paymentMethodId: 'pm_1', userId: 'user-1', source: 'remove-route' })
    expect(stageEmail).toHaveBeenCalledTimes(1)

    mockDetachedEvent()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(stageEmail).toHaveBeenCalledTimes(1)
    expect(db.state.alternatesDeleted).toBe(1)
  })

  it('cleans up and emails once for a removal made outside the app', async () => {
    const db = makeFakeDb('pm_1')
    ;(createAdminClient as jest.Mock).mockReturnValue(db.supabase)
    mockDetachedEvent()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(db.state.user.stripe_payment_method_id).toBeNull()
    expect(db.state.alternatesDeleted).toBe(1)
    expect(stageEmail).toHaveBeenCalledTimes(1)
  })
})
