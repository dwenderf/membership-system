// Tests for the authenticated member export that replaced the anon-callable
// get_users_data() / get_full_data() / get_current_data() database functions.

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

const empty = (): QueryResult => ({ data: [], error: null })

// Result per table; a test sets the rows the route should see.
// A function is called once per read, for tests that page through many rows.
let results: Record<string, QueryResult | (() => QueryResult)> = {}

// Chainable stub matching the postgrest-js builder surface the route uses.
// Queries are recorded per table so tests can assert on how they were built.
const queries: Record<string, Array<Record<string, jest.Mock>>> = {}

const makeQuery = (table: string) => {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'order', 'range', 'is', 'not', 'eq']) {
    query[method] = jest.fn(() => query)
  }
  query.overrideTypes = jest.fn(() => {
    const result = results[table]
    return Promise.resolve(typeof result === 'function' ? result() : (result ?? empty()))
  })
  ;(queries[table] ??= []).push(query)
  return query
}

const orderedColumns = (query: Record<string, jest.Mock>) =>
  query.order.mock.calls.map((call) => call[0])

const mockSupabase = { from: jest.fn((table: string) => makeQuery(table)) }
jest.requireMock('@/lib/supabase/admin').createAdminClient = jest.fn(() => mockSupabase)

const SECRET = 'test-export-secret'
const BASE = 'http://localhost/api/admin/exports/members'

const request = (url: string, token?: string) =>
  new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

const get = (query = '') => GET(request(`${BASE}${query}`, SECRET))

const user = (id: string, memberId: number, overrides: Record<string, unknown> = {}) => ({
  id,
  member_id: memberId,
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: `${id}@example.com`,
  onboarding_completed_at: '2026-01-02T03:04:05+00:00',
  ...overrides,
})

const membership = (userId: string, validUntil: string) => ({
  user_id: userId,
  valid_until: validUntil,
})

describe('/api/admin/exports/members', () => {
  const originalSecret = process.env.EXPORT_API_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of Object.keys(queries)) delete queries[key]
    process.env.EXPORT_API_SECRET = SECRET
    results = {}
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
    it('rejects the retired members and memberships datasets', async () => {
      for (const dataset of ['members', 'memberships', 'everything']) {
        const response = await get(`?dataset=${dataset}`)
        expect(response.status).toBe(400)
      }
    })

    it('rejects parameters from the retired datasets instead of ignoring them', async () => {
      for (const param of ['include_expired=true', 'include_deleted=true', 'paid_only=true']) {
        const response = await get(`?${param}`)
        expect(response.status).toBe(400)
      }
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('rejects an unknown membership_status', async () => {
      expect((await get('?membership_status=all')).status).toBe(400)
      expect((await get('?membership_status=current,bogus')).status).toBe(400)
      expect((await get('?membership_status=')).status).toBe(400)
    })

    it('rejects a membership_id that is not a uuid', async () => {
      expect((await get('?membership_id=abc')).status).toBe(400)
    })

    it('rejects an unknown format', async () => {
      expect((await get('?format=xml')).status).toBe(400)
    })
  })

  describe('which users are read', () => {
    it('reads only onboarded, non-deleted users', async () => {
      await get()

      const [query] = queries.users
      expect(query.not).toHaveBeenCalledWith('onboarding_completed_at', 'is', null)
      expect(query.is).toHaveBeenCalledWith('deleted_at', null)
    })

    it('does not filter memberships by type unless membership_id is given', async () => {
      await get()

      expect(queries.user_memberships[0].eq).not.toHaveBeenCalledWith(
        'membership_id',
        expect.anything()
      )
    })

    it('restricts memberships to one type with membership_id', async () => {
      const id = '123e4567-e89b-12d3-a456-426614174000'
      await get(`?membership_id=${id}`)

      expect(queries.user_memberships[0].eq).toHaveBeenCalledWith('membership_id', id)
    })

    it('counts only paid memberships, whatever the other parameters', async () => {
      for (const query of ['', '?membership_status=current,expired,never', '?membership_id=123e4567-e89b-12d3-a456-426614174000']) {
        for (const key of Object.keys(queries)) delete queries[key]

        await get(query)

        expect(queries.user_memberships[0].eq).toHaveBeenCalledWith('payment_status', 'paid')
      }
    })
  })

  describe('membership_status', () => {
    afterEach(() => {
      jest.useRealTimers()
    })

    const seed = () => {
      results.users = {
        data: [user('cur', 1001), user('exp', 1002), user('nev', 1003)],
        error: null,
      }
      results.user_memberships = {
        data: [
          membership('cur', '2027-08-31'),
          membership('exp', '2026-01-31'),
          // An older, lapsed membership must not hide the newer current one.
          membership('cur', '2025-01-31'),
        ],
        error: null,
      }
    }

    const statuses = async (query = '') => {
      const body = await (await get(query)).json()
      return body.rows.map((r: { user_id: string; membership_status: string }) => [
        r.user_id,
        r.membership_status,
      ])
    }

    it('returns only current users by default', async () => {
      seed()

      expect(await statuses()).toEqual([['cur', 'current']])
    })

    it('classifies current, expired and never, and returns each when asked', async () => {
      seed()

      expect(await statuses('?membership_status=current,expired,never')).toEqual([
        ['cur', 'current'],
        ['exp', 'expired'],
        ['nev', 'never'],
      ])
    })

    it('returns people who ever held a membership with current,expired', async () => {
      seed()

      expect(await statuses('?membership_status=current,expired')).toEqual([
        ['cur', 'current'],
        ['exp', 'expired'],
      ])
    })

    it('returns only never-members with membership_status=never', async () => {
      seed()

      expect(await statuses('?membership_status=never')).toEqual([['nev', 'never']])
    })

    it('treats a membership that expires today as current, in the app timezone', async () => {
      // 2026-03-15 01:00 UTC is still 2026-03-14 in New York.
      // Fake only Date: reading the response body needs the real timers.
      jest.useFakeTimers({
        now: new Date('2026-03-15T01:00:00Z'),
        doNotFake: [
          'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
          'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
          'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
        ],
      })
      results.users = { data: [user('today', 1001), user('yday', 1002)], error: null }
      results.user_memberships = {
        data: [membership('today', '2026-03-14'), membership('yday', '2026-03-13')],
        error: null,
      }

      expect(await statuses('?membership_status=current,expired')).toEqual([
        ['today', 'current'],
        ['yday', 'expired'],
      ])
    })
  })

  describe('row shape', () => {
    it('returns identity, status, valid_until and onboarding_completed_at', async () => {
      results.users = { data: [user('u1', 1000)], error: null }
      results.user_memberships = { data: [membership('u1', '2999-08-31')], error: null }

      const body = await (await get()).json()

      expect(body.rows[0]).toEqual({
        user_id: 'u1',
        member_id: 1000,
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'u1@example.com',
        membership_status: 'current',
        valid_until: '2999-08-31',
        onboarding_completed_at: '2026-01-02T03:04:05+00:00',
      })
    })

    it('has a null valid_until for a user who never held a membership', async () => {
      results.users = { data: [user('u1', 1000)], error: null }

      const body = await (await get('?membership_status=never')).json()

      expect(body.rows[0].valid_until).toBeNull()
    })

    it('does not leak columns beyond the documented shape', async () => {
      results.users = { data: [user('u1', 1000, { phone: '555', is_admin: true })], error: null }
      results.user_memberships = { data: [membership('u1', '2999-08-31')], error: null }

      const body = await (await get()).json()

      expect(Object.keys(body.rows[0]).sort()).toEqual(
        [
          'email',
          'first_name',
          'last_name',
          'member_id',
          'membership_status',
          'onboarding_completed_at',
          'user_id',
          'valid_until',
        ].sort()
      )
    })
  })

  describe('pagination', () => {
    // .range() is OFFSET/LIMIT. Without a total order, PostgreSQL may return
    // rows in a different order per page, so pages overlap or skip rows and the
    // export is silently short. Both queries must order by something unique and
    // non-null.
    it('orders users by a unique, non-null key', async () => {
      await get()

      // member_id is UNIQUE but nullable, so id must break ties among NULLs.
      expect(orderedColumns(queries.users[0])).toEqual(['member_id', 'id'])
    })

    it('orders memberships by primary key', async () => {
      await get()

      expect(orderedColumns(queries.user_memberships[0])).toEqual(['id'])
    })

    it('orders before ranging, so every page is a slice of one ordering', async () => {
      await get()

      expect(queries.users[0].range).toHaveBeenCalledWith(0, 999)
      expect(queries.user_memberships[0].range).toHaveBeenCalledWith(0, 999)
    })

    it('fails with 500 rather than returning a users list cut at the row cap', async () => {
      const page = Array.from({ length: 1000 }, (_, i) => user(`u${i}`, i))
      results.users = { data: page, error: null }

      const response = await get()

      expect(response.status).toBe(500)
    })

    it('does not cap the membership history, only the rows returned', async () => {
      results.users = { data: [user('u1', 1000)], error: null }
      // 60 full pages (60,000 rows, past the 50,000 cap), then the last one.
      let calls = 0
      results.user_memberships = () => {
        calls += 1
        const data =
          calls <= 60
            ? Array.from({ length: 1000 }, () => membership('u1', '2020-01-01'))
            : [membership('u1', '2999-08-31')]
        return { data, error: null }
      }

      const response = await get()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(calls).toBe(61)
      expect(body.rows[0].valid_until).toBe('2999-08-31')
    })
  })

  describe('output', () => {
    it('returns rows as JSON with a count', async () => {
      results.users = { data: [user('u1', 1000)], error: null }
      results.user_memberships = { data: [membership('u1', '2999-08-31')], error: null }

      const response = await get()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.dataset).toBe('users')
      expect(body.count).toBe(1)
      expect(body.rows[0].email).toBe('u1@example.com')
    })

    it('quotes CSV values containing commas and quotes, and leaves null valid_until empty', async () => {
      results.users = {
        data: [user('u1', 1001, { first_name: 'Grace, "Amazing"' })],
        error: null,
      }

      const response = await get('?format=csv&membership_status=never')
      const body = await response.text()

      expect(response.headers.get('content-type')).toContain('text/csv')
      expect(body).toContain('"Grace, ""Amazing"""')
      expect(body.split('\n')[0]).toContain('membership_status,valid_until,onboarding_completed_at')
      expect(body.split('\n')[1]).toContain(',never,,')
    })

    it('is never cached', async () => {
      const response = await get()

      expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 500 without leaking the database error', async () => {
      results.users = { data: null, error: { message: 'relation "users" does not exist' } }

      const response = await get()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(JSON.stringify(body)).not.toContain('relation')
    })
  })
})
