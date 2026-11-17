// Tests for the authenticated export of registration_reports_data.

import { GET } from '@/app/api/admin/exports/registrations/route'
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

// A function is called once per page read, for tests that page through many rows.
let result: QueryResult | (() => QueryResult) = empty()

const queries: Array<Record<string, jest.Mock>> = []

const makeQuery = () => {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'order', 'range']) {
    query[method] = jest.fn(() => query)
  }
  query.overrideTypes = jest.fn(() =>
    Promise.resolve(typeof result === 'function' ? result() : result)
  )
  queries.push(query)
  return query
}

const mockSupabase = { from: jest.fn(() => makeQuery()) }
jest.requireMock('@/lib/supabase/admin').createAdminClient = jest.fn(() => mockSupabase)

const SECRET = 'test-export-secret'
const BASE = 'http://localhost/api/admin/exports/registrations'

const request = (url: string, token?: string) =>
  new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

const get = (query = '') => GET(request(`${BASE}${query}`, SECRET))

const row = (overrides: Record<string, unknown> = {}) => ({
  line_item_id: 'li-1',
  line_amount: 100,
  quantity: 1,
  line_item_type: 'registration',
  description: 'Fall league',
  discount_code_id: null,
  item_id: 'reg-1',
  line_item_created_at: '2026-01-02T03:04:05+00:00',
  invoice_id: 'inv-1',
  invoice_number: 'INV-001',
  invoice_type: 'ACCREC',
  invoice_status: 'AUTHORISED',
  sync_status: 'synced',
  invoice_created_at: '2026-01-02T03:04:05+00:00',
  invoice_updated_at: '2026-01-02T03:04:05+00:00',
  payment_id: 'pay-1',
  payment_status: 'completed',
  payment_amount: 100,
  payment_created_at: '2026-01-02T03:04:05+00:00',
  user_id: 'user-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  discount_code: null,
  discount_category_id: null,
  discount_category_name: null,
  absolute_amount: 100,
  customer_name: 'Ada Lovelace',
  total_refunded: 0,
  registration_id: 'reg-1',
  registration_name: 'Fall League',
  registration_type: 'league',
  registration_category_id: 'cat-1',
  registration_category_name: 'Adult',
  registration_category_price: 100,
  category_name: 'Adult',
  season_id: 'season-1',
  season_name: 'Fall 2026',
  ...overrides,
})

describe('/api/admin/exports/registrations', () => {
  const originalSecret = process.env.EXPORT_API_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    queries.length = 0
    process.env.EXPORT_API_SECRET = SECRET
    result = empty()
  })

  afterAll(() => {
    process.env.EXPORT_API_SECRET = originalSecret
  })

  describe('authentication', () => {
    it('fails closed with 503 when EXPORT_API_SECRET is not configured', async () => {
      delete process.env.EXPORT_API_SECRET

      const response = await GET(request(BASE, SECRET))

      expect(response.status).toBe(503)
    })

    it('rejects a request with no Authorization header', async () => {
      const response = await GET(request(BASE))

      expect(response.status).toBe(401)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('rejects a wrong secret', async () => {
      const response = await GET(request(BASE, 'not-the-secret'))

      expect(response.status).toBe(401)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('rejects a secret that only shares a prefix', async () => {
      const response = await GET(request(BASE, SECRET.slice(0, 5)))

      expect(response.status).toBe(401)
    })

    it('never logs the presented token', async () => {
      await GET(request(BASE, 'sensitive-guess'))

      const logged = JSON.stringify(mockLogger.logAdminAction.mock.calls)
      expect(logged).not.toContain('sensitive-guess')
    })

    it('accepts the correct secret', async () => {
      const response = await GET(request(BASE, SECRET))

      expect(response.status).toBe(200)
    })
  })

  describe('parameters', () => {
    it('rejects an unknown format', async () => {
      expect((await get('?format=xml')).status).toBe(400)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('querying the view', () => {
    it('reads every column from registration_reports_data', async () => {
      await get()

      expect(mockSupabase.from).toHaveBeenCalledWith('registration_reports_data')
      expect(queries[0].select).toHaveBeenCalledWith('*')
    })

    it('orders by the view\'s unique, non-null key before ranging', async () => {
      await get()

      expect(queries[0].order).toHaveBeenCalledWith('line_item_id', { ascending: true })
      expect(queries[0].range).toHaveBeenCalledWith(0, 999)
    })

    it('pages through until a short page is returned, with no row cap', async () => {
      let calls = 0
      result = () => {
        calls += 1
        const data = calls <= 2 ? Array.from({ length: 1000 }, () => row()) : [row()]
        return { data, error: null }
      }

      const response = await get()
      const body = await response.json()

      expect(calls).toBe(3)
      expect(body.count).toBe(2001)
      expect(queries[1].range).toHaveBeenCalledWith(1000, 1999)
      expect(queries[2].range).toHaveBeenCalledWith(2000, 2999)
    })
  })

  describe('output', () => {
    it('returns rows as JSON with a dataset name and count', async () => {
      result = { data: [row()], error: null }

      const response = await get()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.dataset).toBe('registrations')
      expect(body.count).toBe(1)
      expect(body.rows[0].email).toBe('ada@example.com')
    })

    it('returns CSV with a header row and escapes commas and quotes', async () => {
      result = { data: [row({ description: 'Fall, "League"' })], error: null }

      const response = await get('?format=csv')
      const body = await response.text()

      expect(response.headers.get('content-type')).toContain('text/csv')
      expect(body.split('\n')[0]).toContain('line_item_id,line_amount')
      expect(body).toContain('"Fall, ""League"""')
    })

    it('is never cached', async () => {
      const response = await get()

      expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 500 without leaking the database error', async () => {
      result = { data: null, error: { message: 'relation "registration_reports_data" does not exist' } }

      const response = await get()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(JSON.stringify(body)).not.toContain('relation')
    })
  })
})
