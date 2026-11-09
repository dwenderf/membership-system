import { POST } from '@/app/api/update-registration-status/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/logging/logger')
jest.mock('@/lib/stripe/server-client')

type Call = { method: string; args: unknown[] }

// Chainable query-builder stub: records every call and resolves to `result`.
function builder(result: { data: unknown; error: unknown }, calls: Call[]) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'eq', 'in', 'order', 'limit']) {
    b[m] = jest.fn((...args: unknown[]) => {
      calls.push({ method: m, args })
      return b
    })
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return b
}

const USER_ID = 'user-1'
let lookupResult: { data: unknown; error: unknown }
let updateResult: { data: unknown; error: unknown }
let lookupCalls: Call[]
let updateCalls: Call[]
let fromCount: number
const retrieve = jest.fn()

const userClient = { auth: { getUser: jest.fn() } }
const adminClient = {
  from: jest.fn(() => {
    fromCount += 1
    return fromCount === 1 ? builder(lookupResult, lookupCalls) : builder(updateResult, updateCalls)
  }),
}

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(userClient))
jest.requireMock('@/lib/supabase/server').createAdminClient = jest.fn(() => adminClient)
jest.requireMock('@/lib/logging/logger').logger = { logSystem: jest.fn(), logPaymentProcessing: jest.fn() }
jest.requireMock('@/lib/stripe/server-client').getStripe = jest.fn(() => ({ paymentIntents: { retrieve } }))

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/update-registration-status', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

describe('/api/update-registration-status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fromCount = 0
    lookupCalls = []
    updateCalls = []
    userClient.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
    lookupResult = { data: [{ id: 'res-1', payment_status: 'awaiting_payment' }], error: null }
    updateResult = { data: [{ id: 'res-1' }], error: null }
  })

  it('requires a signed-in user', async () => {
    userClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'failed' })
    expect(res.status).toBe(401)
  })

  it.each(['paid', 'refunded', 'awaiting_payment'])('rejects status %s from the browser', async (status) => {
    const res = await post({ registrationId: 'r', categoryId: 'c', status })
    expect(res.status).toBe(400)
    expect(adminClient.from).not.toHaveBeenCalled()
  })

  it('marks an in-flight reservation failed, scoped to the caller and unfinished rows', async () => {
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'failed' })
    expect(res.status).toBe(200)
    const update = updateCalls.find((c) => c.method === 'update')
    expect(update?.args[0]).toEqual({ payment_status: 'failed', reservation_expires_at: null })
    expect(updateCalls).toContainEqual({ method: 'eq', args: ['user_id', USER_ID] })
    expect(updateCalls).toContainEqual({ method: 'in', args: ['payment_status', ['awaiting_payment', 'processing']] })
  })

  it('ignores client-supplied membership and registration timestamps', async () => {
    await post({ registrationId: 'r', categoryId: 'c', status: 'failed', userMembershipId: 'm', registeredAt: '2020-01-01' })
    const update = updateCalls.find((c) => c.method === 'update')
    expect(update?.args[0]).not.toHaveProperty('user_membership_id')
    expect(update?.args[0]).not.toHaveProperty('registered_at')
  })

  it('requires a payment intent for processing', async () => {
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'processing' })
    expect(res.status).toBe(400)
  })

  it('rejects processing with a payment intent created for someone else', async () => {
    retrieve.mockResolvedValue({ metadata: { userId: 'other', registrationId: 'r', categoryId: 'c' } })
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'processing', stripePaymentIntentId: 'pi_1' })
    expect(res.status).toBe(400)
    expect(updateCalls.find((c) => c.method === 'update')).toBeUndefined()
  })

  it('rejects processing with a payment intent for another category', async () => {
    retrieve.mockResolvedValue({ metadata: { userId: USER_ID, registrationId: 'r', categoryId: 'other' } })
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'processing', stripePaymentIntentId: 'pi_1' })
    expect(res.status).toBe(400)
  })

  it('accepts processing with the matching payment intent', async () => {
    retrieve.mockResolvedValue({ metadata: { userId: USER_ID, registrationId: 'r', categoryId: 'c', reservationId: 'res-1' } })
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'processing', stripePaymentIntentId: 'pi_1' })
    expect(res.status).toBe(200)
    const update = updateCalls.find((c) => c.method === 'update')
    expect(update?.args[0]).toEqual({ payment_status: 'processing', reservation_expires_at: null, stripe_payment_intent_id: 'pi_1' })
    expect(updateCalls).toContainEqual({ method: 'in', args: ['id', ['res-1']] })
  })

  it('returns 404 when there is no unfinished reservation', async () => {
    lookupResult = { data: [], error: null }
    const res = await post({ registrationId: 'r', categoryId: 'c', status: 'failed' })
    expect(res.status).toBe(404)
  })
})
