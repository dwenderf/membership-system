// Admin-only API routes must reject a caller with no session (401) and a
// signed-in non-admin (403) before doing any work, and the removed debug/test
// routes must stay removed.
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/logging/logger')
jest.mock('@/lib/xero/client', () => ({ getActiveTenant: jest.fn(), getAuthenticatedXeroClient: jest.fn() }))
jest.mock('@/lib/xero/accounts-sync', () => ({ getLastSyncInfo: jest.fn() }))
jest.mock('@/lib/accounting-codes', () => ({ getFrequentlyUsedAccountingCodes: jest.fn() }))
jest.mock('@/lib/email/batch-sync-email', () => ({ emailBatchSyncManager: {} }))

const mockCreateClient = createClient as jest.Mock
const mockCreateAdminClient = createAdminClient as jest.Mock

// Session client: getUser() returns `user`; users.is_admin lookup returns `isAdmin`.
function sessionAs(user: { id: string; email?: string } | null, isAdmin = false) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { is_admin: isAdmin } }) })),
      })),
    })),
  })
}

// A permissive service-role stub, so a route that skips the auth check runs
// on and returns something other than 401/403.
function anyChain(): unknown {
  const result = { data: [], count: 0, error: null }
  const handler: ProxyHandler<object> = {
    get: (_t, prop) => (prop === 'then' ? (r: (v: unknown) => unknown) => Promise.resolve(result).then(r) : () => new Proxy({}, handler)),
  }
  return new Proxy({}, handler)
}

const routes: Array<[string, () => Promise<Response>]> = [
  ['GET /api/admin/system-events', async () => (await import('@/app/api/admin/system-events/route')).GET(new NextRequest('http://localhost/api/admin/system-events'))],
  ['GET /api/admin/sync-emails', async () => (await import('@/app/api/admin/sync-emails/route')).GET()],
  ['POST /api/admin/sync-emails', async () => (await import('@/app/api/admin/sync-emails/route')).POST()],
  ['GET /api/xero/accounts', async () => (await import('@/app/api/xero/accounts/route')).GET(new NextRequest('http://localhost/api/xero/accounts'))],
  ['GET /api/xero/validate-account-code', async () => (await import('@/app/api/xero/validate-account-code/route')).GET(new NextRequest('http://localhost/api/xero/validate-account-code?code=200'))],
]

describe('admin API route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateAdminClient.mockReturnValue(anyChain())
  })

  it.each(routes)('%s rejects a caller with no session (401)', async (_name, call) => {
    sessionAs(null)
    const response = await call()
    expect(response.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it.each(routes)('%s rejects a signed-in non-admin (403)', async (_name, call) => {
    sessionAs({ id: 'member-1', email: 'member@example.test' }, false)
    const response = await call()
    expect(response.status).toBe(403)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})

describe('removed debug and test API routes', () => {
  it.each([
    'debug/xero-contacts',
    'debug/xero-tokens',
    'debug/clear-contact-cache',
    'debug/request-info',
    'test-email-simple',
    'test-sentry',
  ])('src/app/api/%s is gone', (route) => {
    const dir = path.join(process.cwd(), 'src', 'app', 'api', route)
    expect(fs.existsSync(path.join(dir, 'route.ts'))).toBe(false)
  })
})
