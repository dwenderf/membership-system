jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/stripe/server-client', () => ({ getStripe: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: jest.fn(), logSystem: jest.fn() } }))

import { GET } from '@/app/api/user-payment-method/route'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'

function setup(customer: string | null, userCustomerId: string | null = 'cus_1') {
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_payment_method_id: 'pm_1', setup_intent_status: 'succeeded', stripe_customer_id: userCustomerId } }) }) }) }),
  })
  ;(getStripe as jest.Mock).mockReturnValue({ paymentMethods: { retrieve: jest.fn().mockResolvedValue({ id: 'pm_1', customer, card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2030 } }) } })
}

describe('GET /api/user-payment-method', () => {
  it('returns null for a detached payment method (customer: null)', async () => {
    setup(null)
    expect(await (await GET()).json()).toEqual({ paymentMethod: null })
  })
  it('returns null for a payment method attached to a different customer', async () => {
    setup('cus_other')
    expect(await (await GET()).json()).toEqual({ paymentMethod: null })
  })
  it('returns the card when attached to the user\'s customer', async () => {
    setup('cus_1')
    expect((await (await GET()).json()).paymentMethod.id).toBe('pm_1')
  })
  it('fails closed when the user has no stripe_customer_id', async () => {
    setup('cus_1', null)
    expect(await (await GET()).json()).toEqual({ paymentMethod: null })
  })
})
