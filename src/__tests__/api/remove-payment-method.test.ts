jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createAdminClient: jest.fn() }))
jest.mock('@/lib/stripe/server-client', () => ({ getStripe: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: jest.fn(), logSystem: jest.fn() } }))
jest.mock('@/lib/services/payment-plan-service', () => ({ PaymentPlanService: { hasOutstandingBalance: jest.fn(), getTotalOutstandingBalance: jest.fn() } }))
const stageEmail = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: (...a: unknown[]) => stageEmail(...a) } }))

import { DELETE } from '@/app/api/remove-payment-method/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { makeFakeDb } from '@/test-helpers/fake-users-db'

function setup(pm: string | null, detach: jest.Mock, retrieve: jest.Mock = jest.fn()) {
  const db = makeFakeDb(pm)
  const base = db.supabase as unknown as { from: (t: string) => Record<string, unknown> }
  ;(createClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } })
  ;(createAdminClient as jest.Mock).mockReturnValue({
    from(t: string) {
      const tbl = base.from(t)
      return { ...tbl, select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_payment_method_id: db.state.user.stripe_payment_method_id } }) }) }) }
    },
  })
  ;(getStripe as jest.Mock).mockReturnValue({ paymentMethods: { detach, retrieve } })
  return db
}

describe('DELETE /api/remove-payment-method', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID = 'tmpl'; (PaymentPlanService.hasOutstandingBalance as jest.Mock).mockResolvedValue(false) })

  it('detaches, clears the DB card fields, deletes alternates and stages one email', async () => {
    const detach = jest.fn().mockResolvedValue({ id: 'pm_1', customer: null, card: { last4: '4242' } })
    const db = setup('pm_1', detach)
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(detach).toHaveBeenCalledWith('pm_1')
    expect(db.state.user.stripe_payment_method_id).toBeNull()
    expect(db.state.alternatesDeleted).toBe(1)
    expect(stageEmail).toHaveBeenCalledTimes(1)
  })

  it('does not change the DB when the Stripe detach fails', async () => {
    const db = setup('pm_1', jest.fn().mockRejectedValue(new Error('stripe down')))
    const res = await DELETE()
    expect(res.status).toBe(500)
    expect(db.state.user.stripe_payment_method_id).toBe('pm_1')
    expect(db.state.updates).toBe(0)
    expect(db.state.alternatesDeleted).toBe(0)
    expect(stageEmail).not.toHaveBeenCalled()
  })

  it('returns 400 with an outstanding payment plan balance', async () => {
    ;(PaymentPlanService.hasOutstandingBalance as jest.Mock).mockResolvedValue(true)
    ;(PaymentPlanService.getTotalOutstandingBalance as jest.Mock).mockResolvedValue(5000)
    const detach = jest.fn()
    setup('pm_1', detach)
    const res = await DELETE()
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ requiresPayoff: true, outstandingAmount: 5000 })
    expect(detach).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no saved card', async () => {
    const detach = jest.fn()
    setup(null, detach)
    const res = await DELETE()
    expect(res.status).toBe(404)
    expect(detach).not.toHaveBeenCalled()
  })

  const notAttached = Object.assign(new Error('The payment method you provided is not attached to a customer so detachment is impossible.'), { type: 'StripeInvalidRequestError', code: 'payment_method_unexpected_state' })

  it('treats an already-detached card as success and still clears the DB (retry after a failed clear)', async () => {
    const retrieve = jest.fn().mockResolvedValue({ id: 'pm_1', customer: null, card: { last4: '4242' } })
    const db = setup('pm_1', jest.fn().mockRejectedValue(notAttached), retrieve)
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(db.state.user.stripe_payment_method_id).toBeNull()
    expect(stageEmail).toHaveBeenCalledTimes(1)
  })

  it('treats a card Stripe no longer has (resource_missing) as already detached', async () => {
    const retrieve = jest.fn().mockRejectedValue(Object.assign(new Error('No such PaymentMethod'), { type: 'StripeInvalidRequestError', code: 'resource_missing' }))
    const db = setup('pm_1', jest.fn().mockRejectedValue(notAttached), retrieve)
    expect((await DELETE()).status).toBe(200)
    expect(db.state.user.stripe_payment_method_id).toBeNull()
  })

  it('does not clear the DB on an invalid-request error when the card is still attached', async () => {
    const retrieve = jest.fn().mockResolvedValue({ id: 'pm_1', customer: 'cus_1' })
    const db = setup('pm_1', jest.fn().mockRejectedValue(notAttached), retrieve)
    expect((await DELETE()).status).toBe(500)
    expect(db.state.user.stripe_payment_method_id).toBe('pm_1')
    expect(stageEmail).not.toHaveBeenCalled()
  })
})
