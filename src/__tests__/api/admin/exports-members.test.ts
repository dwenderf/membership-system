// Tests for the authenticated member export that replaced the anon-callable
// get_users_data() / get_full_data() / get_current_data() database functions.
//
// jest.setup.js replaces next/server globally with a stub whose NextRequest
// drops the headers passed to it and whose NextResponse has no constructor.
// This suite is about an Authorization header and a CSV response body, so it
// opts out and exercises the real implementations.
jest.unmock('next/server')

import { GET } from '@/app/api/admin/exports/members/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/admin')
jest.mock('@/lib/logging/logger')

const mockLogger = { logAdminAction: jest.fn() }
jest.requireMock('@/lib/logging/logger').logger = mockLogger

interface QueryResult {
  data: unknown[] | null
  error: { message: string } | null
}

let queryResult: QueryResult = { data: [], error: null }

// Chainable stub matching the postgrest-js builder surface the route uses.
// Queries are recorded so tests can assert on how they were built.
const queries: Array<Record<string, jest.Mock>> = []

const makeQuery = () => {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'order', 'range', 'is', 'eq']) {
    query[method] = jest.fn(() => query)
  }
  query.overrideTypes = jest.fn(() => Promise.resolve(queryResult))
  queries.push(query)
  return query
}

const orderedColumns = (query: Record<string, jest.Mock>) =>
  query.order.mock.calls.map((call) => call[0])

const mockSupabase = { from: jest.fn(() => makeQuery()) }
jest.requireMock('@/lib/supabase/admin').createAdminClient = jest.fn(() => mockSupabase)

const SECRET = 'test-export-secret'

const request = (url: string, token?: string) =>
  new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

describe('/api/admin/exports/members', () => {
  const originalSecret = process.env.EXPORT_API_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    queries.length = 0
    process.env.EXPORT_API_SECRET = SECRET
    queryResult = { data: [], error: null }
  })

  afterAll(() => {
    process.env.EXPORT_API_SECRET = originalSecret
  })

  describe('authentication', () => {
    it('fails closed with 503 when EXPORT_API_SECRET is not configured', async () => {
      delete process.env.EXPORT_API_SECRET

      const response = await GET(request('http://localhost/api/admin/exports/members', SECRET))

      // A missing secret must never be read as "no authentication required".
      expect(response.status).toBe(503)
    })

    it('rejects a request with no Authorization header', async () => {
      const response = await GET(request('http://localhost/api/admin/exports/members'))

      expect(response.status).toBe(401)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('rejects a wrong secret', async () => {
      const response = await GET(
        request('http://localhost/api/admin/exports/members', 'not-the-secret')
      )

      expect(response.status).toBe(401)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('rejects a secret that only shares a prefix', async () => {
      const response = await GET(
        request('http://localhost/api/admin/exports/members', SECRET.slice(0, 5))
      )

      expect(response.status).toBe(401)
    })

    it('never logs the presented token', async () => {
      await GET(request('http://localhost/api/admin/exports/members', 'sensitive-guess'))

      const logged = JSON.stringify(mockLogger.logAdminAction.mock.calls)
      expect(logged).not.toContain('sensitive-guess')
    })

    it('accepts the correct secret', async () => {
      const response = await GET(request('http://localhost/api/admin/exports/members', SECRET))

      expect(response.status).toBe(200)
    })
  })

  describe('parameters', () => {
    it('rejects an unknown dataset', async () => {
      const response = await GET(
        request('http://localhost/api/admin/exports/members?dataset=everything', SECRET)
      )

      expect(response.status).toBe(400)
    })

    it('rejects a membership_id that is not a uuid', async () => {
      const response = await GET(
        request('http://localhost/api/admin/exports/members?dataset=memberships&membership_id=abc', SECRET)
      )

      expect(response.status).toBe(400)
    })
  })

  describe('pagination', () => {
    // .range() is OFFSET/LIMIT. Without a total order, PostgreSQL may return
    // rows in a different order per page, so pages overlap or skip rows and the
    // export is silently short. Both queries must order by something unique and
    // non-null.
    it('orders members by a unique, non-null key', async () => {
      await GET(request('http://localhost/api/admin/exports/members', SECRET))

      // member_id is UNIQUE but nullable, so id must break ties among NULLs.
      expect(orderedColumns(queries[0])).toEqual(['member_id', 'id'])
    })

    it('orders memberships by primary key', async () => {
      await GET(
        request('http://localhost/api/admin/exports/members?dataset=memberships', SECRET)
      )

      expect(orderedColumns(queries[0])).toContain('id')
    })

    it('orders before ranging, so every page is a slice of one ordering', async () => {
      await GET(request('http://localhost/api/admin/exports/members', SECRET))

      expect(queries[0].order).toHaveBeenCalled()
      expect(queries[0].range).toHaveBeenCalledWith(0, 999)
    })
  })

  describe('output', () => {
    it('returns member rows as JSON', async () => {
      queryResult = {
        data: [
          { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', member_id: 1000 },
        ],
        error: null,
      }

      const response = await GET(request('http://localhost/api/admin/exports/members', SECRET))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.count).toBe(1)
      expect(body.rows[0].email).toBe('ada@example.com')
    })

    it('quotes CSV values containing commas and quotes', async () => {
      queryResult = {
        data: [
          { first_name: 'Grace, "Amazing"', last_name: 'Hopper', email: 'grace@example.com', member_id: 1001 },
        ],
        error: null,
      }

      const response = await GET(
        request('http://localhost/api/admin/exports/members?format=csv', SECRET)
      )
      const body = await response.text()

      expect(response.headers.get('content-type')).toContain('text/csv')
      expect(body).toContain('"Grace, ""Amazing"""')
    })

    it('is never cached', async () => {
      const response = await GET(request('http://localhost/api/admin/exports/members', SECRET))

      expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 500 without leaking the database error', async () => {
      queryResult = { data: null, error: { message: 'relation "users" does not exist' } }

      const response = await GET(request('http://localhost/api/admin/exports/members', SECRET))
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(JSON.stringify(body)).not.toContain('relation')
    })
  })
})
