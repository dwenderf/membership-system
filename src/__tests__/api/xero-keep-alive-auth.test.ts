// /api/xero/keep-alive is a scheduled job: it must refuse callers that do not
// present the cron secret, signed in or not, before touching the database.
import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/logging/logger')
jest.mock('@/lib/xero/client', () => ({ getAuthenticatedXeroClient: jest.fn() }))

const tokensQuery = () => ({
  from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) })) })),
})

describe('/api/xero/keep-alive auth', () => {
  const original = process.env.CRON_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    ;(createAdminClient as jest.Mock).mockReturnValue(tokensQuery())
  })
  afterAll(() => {
    process.env.CRON_SECRET = original
  })

  it.each(['GET', 'POST'] as const)('%s rejects a caller with no session and no cron secret (401)', async (method) => {
    ;(createClient as jest.Mock).mockResolvedValue({ auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) }, ...tokensQuery() })
    const route = await import('@/app/api/xero/keep-alive/route')
    const response = await (route[method] as (r: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/xero/keep-alive', { method }))
    expect(response.status).toBe(401)
  })

  it('rejects a signed-in member without the cron secret (401)', async () => {
    ;(createClient as jest.Mock).mockResolvedValue({ auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'member-1' } } }) }, ...tokensQuery() })
    const route = await import('@/app/api/xero/keep-alive/route')
    const response = await (route.GET as (r: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/xero/keep-alive'))
    expect(response.status).toBe(401)
  })

  it('rejects a wrong cron secret (401)', async () => {
    const route = await import('@/app/api/xero/keep-alive/route')
    const response = await (route.GET as (r: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/xero/keep-alive', { headers: { authorization: 'Bearer nope' } }))
    expect(response.status).toBe(401)
  })

  it('runs with the cron secret', async () => {
    const route = await import('@/app/api/xero/keep-alive/route')
    const response = await (route.GET as (r: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/xero/keep-alive', { headers: { authorization: 'Bearer test-secret' } }))
    expect(response.status).toBe(200)
  })
})
