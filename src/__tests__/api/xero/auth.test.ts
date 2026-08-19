/**
 * Unit tests for /api/xero/auth route
 * Verifies a fresh CSRF state token is generated, passed to the Xero client,
 * and set as an httpOnly cookie on the response.
 */

jest.mock('next/server', () => require('../../../test-helpers/mock-next-server'))

import { GET } from '@/app/api/xero/auth/route'
import { createXeroOAuthClient } from '@/lib/xero/client'
import { XERO_OAUTH_STATE_COOKIE } from '@/lib/xero/oauth-state'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/xero/client', () => ({
  createXeroOAuthClient: jest.fn()
}))

const mockSupabase: any = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))

describe('/api/xero/auth GET', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('requires authentication', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Unauthorized' } })

    const response = await GET()
    expect(response.status).toBe(401)
    expect(createXeroOAuthClient).not.toHaveBeenCalled()
  })

  it('requires admin access', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { is_admin: false }, error: null })
        })
      })
    })

    const response = await GET()
    expect(response.status).toBe(403)
    expect(createXeroOAuthClient).not.toHaveBeenCalled()
  })

  it('generates a state token, seeds the Xero client with it, and sets it as an httpOnly cookie', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
        })
      })
    })

    const buildConsentUrl = jest.fn().mockResolvedValue('https://login.xero.com/identity/connect/authorize?...')
    ;(createXeroOAuthClient as jest.Mock).mockImplementation(() => ({ buildConsentUrl }))

    const response = await GET()
    const body = await response.json()

    expect(body.consentUrl).toBe('https://login.xero.com/identity/connect/authorize?...')

    const stateArg = (createXeroOAuthClient as jest.Mock).mock.calls[0][0]
    expect(typeof stateArg).toBe('string')
    expect(stateArg.length).toBeGreaterThanOrEqual(32)

    const cookie = response.cookies.get(XERO_OAUTH_STATE_COOKIE)
    expect(cookie?.value).toBe(stateArg)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.path).toBe('/api/xero/callback')
  })
})
