/**
 * /api/xero/debug-config reports the scopes the app will request and flags
 * any broad scope Xero retires on 13 Sep 2027 (#333).
 */

jest.mock('next/server', () => jest.requireActual('../../../test-helpers/mock-next-server'))

import { GET } from '@/app/api/xero/debug-config/route'

jest.mock('@/lib/supabase/server')

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn(),
}

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))

function signInAsAdmin() {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  mockSupabase.from.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null }),
      }),
    }),
  })
}

describe('/api/xero/debug-config GET', () => {
  const original = process.env.XERO_SCOPES

  beforeEach(() => {
    jest.clearAllMocks()
    signInAsAdmin()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.XERO_SCOPES
    else process.env.XERO_SCOPES = original
  })

  it('shows the granular default when XERO_SCOPES is unset', async () => {
    delete process.env.XERO_SCOPES

    const body = await (await GET()).json()

    expect(body.scopes).toEqual([
      'accounting.invoices',
      'accounting.payments',
      'accounting.contacts',
      'accounting.settings',
      'offline_access',
    ])
    expect(body.scopesFromEnv).toBe(false)
    expect(body.retiringScopes).toEqual([])
  })

  it('flags a stale broad scope still set in XERO_SCOPES', async () => {
    process.env.XERO_SCOPES = 'accounting.transactions accounting.contacts accounting.settings offline_access'

    const body = await (await GET()).json()

    expect(body.scopesFromEnv).toBe(true)
    expect(body.retiringScopes).toEqual(['accounting.transactions'])
  })

  it('still requires an admin', async () => {
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { is_admin: false }, error: null }),
        }),
      }),
    })

    const response = await GET()
    expect(response.status).toBe(403)
  })
})
