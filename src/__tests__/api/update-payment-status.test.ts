import { POST } from '@/app/api/update-payment-status/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/logging/logger')

type Call = { method: string; args: unknown[] }

const USER_ID = 'user-1'
let calls: Call[]
let result: { data: unknown; error: unknown }

function builder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'eq', 'in']) {
    b[m] = jest.fn((...args: unknown[]) => {
      calls.push({ method: m, args })
      return b
    })
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return b
}

const userClient = { auth: { getUser: jest.fn() } }
const adminClient = { from: jest.fn(() => builder()) }

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(userClient))
jest.requireMock('@/lib/supabase/server').createAdminClient = jest.fn(() => adminClient)
jest.requireMock('@/lib/logging/logger').logger = { logSystem: jest.fn(), logPaymentProcessing: jest.fn() }

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/update-payment-status', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

describe('/api/update-payment-status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    calls = []
    result = { data: [{ id: 'pay-1' }], error: null }
    userClient.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  })

  it('requires a signed-in user', async () => {
    userClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await post({ stripePaymentIntentId: 'pi_1', status: 'cancelled' })
    expect(res.status).toBe(401)
  })

  it.each(['completed', 'pending', 'refunded'])('rejects status %s from the browser', async (status) => {
    const res = await post({ stripePaymentIntentId: 'pi_1', status })
    expect(res.status).toBe(400)
    expect(adminClient.from).not.toHaveBeenCalled()
  })

  it.each(['failed', 'cancelled'])('closes out the caller\'s own pending payment as %s', async (status) => {
    const res = await post({ stripePaymentIntentId: 'pi_1', status })
    expect(res.status).toBe(200)
    expect(calls).toContainEqual({ method: 'eq', args: ['user_id', USER_ID] })
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'pending'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['stripe_payment_intent_id', 'pi_1'] })
  })

  it('returns 404 when no pending payment matches', async () => {
    result = { data: [], error: null }
    const res = await post({ stripePaymentIntentId: 'pi_1', status: 'failed' })
    expect(res.status).toBe(404)
  })
})
