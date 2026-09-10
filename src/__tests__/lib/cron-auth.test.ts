// Tests for the shared /api/cron/* auth guard (issue #287).
//
// jest.setup.js replaces next/server globally with a stub whose NextRequest
// drops the headers passed to it. This suite is about an Authorization
// header, so it opts out and exercises the real implementation — the same
// workaround used by src/__tests__/api/admin/exports-members.test.ts.
jest.unmock('next/server')

import { NextRequest } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron/auth'

jest.mock('@/lib/logging/logger')
const mockLogger = { logSystem: jest.fn() }
jest.requireMock('@/lib/logging/logger').logger = mockLogger

const SECRET = 'test-cron-secret'

const request = (token?: string) =>
  new NextRequest('http://localhost/api/cron/whatever', {
    headers: token !== undefined ? { authorization: token } : {},
  })

describe('authorizeCronRequest', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = SECRET
  })

  afterAll(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('fails closed with 503 when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET

    const response = authorizeCronRequest(request(`Bearer ${SECRET}`), 'test-route')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
  })

  it('does not accept the literal header "Bearer undefined" when unset', () => {
    delete process.env.CRON_SECRET

    const response = authorizeCronRequest(request('Bearer undefined'), 'test-route')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
  })

  it('rejects a request with no Authorization header', () => {
    const response = authorizeCronRequest(request(), 'test-route')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })

  it('rejects a wrong secret', () => {
    const response = authorizeCronRequest(request('Bearer not-the-secret'), 'test-route')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })

  it('rejects a secret that only shares a prefix', () => {
    const response = authorizeCronRequest(
      request(`Bearer ${SECRET.slice(0, 5)}`),
      'test-route'
    )

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })

  it('never logs the presented token', () => {
    authorizeCronRequest(request('Bearer sensitive-guess'), 'test-route')

    const logged = JSON.stringify(mockLogger.logSystem.mock.calls)
    expect(logged).not.toContain('sensitive-guess')
  })

  it('accepts the correct secret', () => {
    const response = authorizeCronRequest(request(`Bearer ${SECRET}`), 'test-route')

    expect(response).toBeNull()
  })
})
