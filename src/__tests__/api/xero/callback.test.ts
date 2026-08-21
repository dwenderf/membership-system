/**
 * Unit tests for /api/xero/callback route
 * Verifies the CSRF state cookie is validated before any token exchange happens
 */

jest.mock('next/server', () => jest.requireActual('../../../test-helpers/mock-next-server'))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/xero/callback/route'
import { createXeroOAuthClient } from '@/lib/xero/client'
import { XERO_OAUTH_STATE_COOKIE } from '@/lib/xero/oauth-state'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/xero/client', () => ({
  createXeroOAuthClient: jest.fn(),
  logXeroSync: jest.fn().mockResolvedValue(undefined),
  revokeXeroTokens: jest.fn().mockResolvedValue(true)
}))

interface QueryResult {
  data: unknown
  error: unknown
}

interface MockQueryBuilder {
  select: jest.Mock
  update: jest.Mock
  eq: jest.Mock
  single: jest.Mock
  insert: jest.Mock
  then: Promise<QueryResult>['then']
}

function makeQueryBuilder(result: QueryResult = { data: null, error: null }): MockQueryBuilder {
  const builder = {} as MockQueryBuilder
  builder.select = jest.fn(() => builder)
  builder.update = jest.fn(() => builder)
  builder.eq = jest.fn(() => builder)
  builder.single = jest.fn(() => Promise.resolve(result))
  builder.insert = jest.fn(() => Promise.resolve(result))
  builder.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

type MockSupabaseClient = {
  from: jest.Mock
}

const mockSupabase: MockSupabaseClient = {
  from: jest.fn(() => makeQueryBuilder())
}

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))

function makeRequest(query: string, cookieState?: string) {
  const headers: Record<string, string> = {}
  if (cookieState !== undefined) {
    headers.cookie = `${XERO_OAUTH_STATE_COOKIE}=${cookieState}`
  }
  return new NextRequest(`http://localhost/api/xero/callback${query}`, { headers })
}

describe('/api/xero/callback GET', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSupabase.from.mockImplementation(() => makeQueryBuilder())
  })

  it('redirects with the upstream error when Xero reports one, without checking state', async () => {
    const request = makeRequest('?error=access_denied')
    const response = await GET(request)

    expect(response.headers.get('location')).toContain('xero_error=access_denied')
    expect(createXeroOAuthClient).not.toHaveBeenCalled()
  })

  it('rejects the callback when no state cookie is present', async () => {
    const request = makeRequest('?code=abc&state=whatever')
    const response = await GET(request)

    expect(response.headers.get('location')).toContain('xero_error=missing_state')
    expect(createXeroOAuthClient).not.toHaveBeenCalled()
  })

  it('rejects the callback when the returned state does not match the cookie', async () => {
    const request = makeRequest('?code=abc&state=wrong-value', 'expected-state')
    const response = await GET(request)

    expect(response.headers.get('location')).toContain('xero_error=state_mismatch')
    expect(createXeroOAuthClient).not.toHaveBeenCalled()
  })

  it('rejects the callback when state is returned but missing from the query string', async () => {
    const request = makeRequest('?code=abc', 'expected-state')
    const response = await GET(request)

    expect(response.headers.get('location')).toContain('xero_error=state_mismatch')
  })

  it('clears the state cookie on a mismatch redirect', async () => {
    const request = makeRequest('?code=abc&state=wrong-value', 'expected-state')
    const response = await GET(request)

    const cookie = response.cookies.get(XERO_OAUTH_STATE_COOKIE)
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
  })

  it('proceeds to exchange the code and stores tokens when state matches', async () => {
    const apiCallback = jest.fn().mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
      expires_in: 1800,
      scope: 'openid',
      token_type: 'Bearer'
    })
    const updateTenants = jest.fn().mockResolvedValue([
      { tenantId: 'tenant-1', tenantName: 'Test Org' }
    ])
    ;(createXeroOAuthClient as jest.Mock).mockReturnValue({ apiCallback, updateTenants })

    const request = makeRequest('?code=valid-code&state=matching-state', 'matching-state')
    const response = await GET(request)

    expect(createXeroOAuthClient).toHaveBeenCalledWith('matching-state')
    expect(apiCallback).toHaveBeenCalledWith(request.url)
    expect(updateTenants).toHaveBeenCalledWith(true)
    expect(response.headers.get('location')).toContain('xero_success=connected')

    const cookie = response.cookies.get(XERO_OAUTH_STATE_COOKIE)
    expect(cookie?.maxAge).toBe(0)
  })
})
