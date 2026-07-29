import { PUT } from '@/app/api/admin/discount-codes/[id]/route'
import { NextRequest } from 'next/server'

// Mock Supabase Server Client
var mockSupabase: any = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase))
}))

describe('/api/admin/discount-codes/[id] PUT Allowance & Context Support', () => {
  const adminUser = { id: 'admin-1', email: 'admin@example.com' }
  const normalUser = { id: 'user-1', email: 'user@example.com' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 if unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const req = new NextRequest('http://localhost/api/admin/discount-codes/code-1', {
      method: 'PUT',
      body: JSON.stringify({ code: 'PRIDE' })
    })

    const res = await PUT(req, { params: Promise.resolve({ id: 'code-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 if user is not admin', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: normalUser }, error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { is_admin: false }, error: null })
        })
      })
    })

    const req = new NextRequest('http://localhost/api/admin/discount-codes/code-1', {
      method: 'PUT',
      body: JSON.stringify({ code: 'PRIDE' })
    })

    const res = await PUT(req, { params: Promise.resolve({ id: 'code-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows updating an allowance-driven code without a percentage and persists percentage: null', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: adminUser }, error: null })

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'code-pride', code: 'PRIDE', percentage: null, uses_user_allowance: true, is_active: false },
            error: null
          })
        })
      })
    })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
            })
          })
        }
      }

      if (table === 'discount_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'code-pride', code: 'PRIDE', uses_user_allowance: true },
                error: null
              })
            }),
            neq: jest.fn().mockResolvedValue({ data: [], error: null })
          }),
          update: updateMock
        }
      }

      return {}
    })

    const req = new NextRequest('http://localhost/api/admin/discount-codes/code-pride', {
      method: 'PUT',
      body: JSON.stringify({
        code: 'PRIDE',
        is_active: false
      })
    })

    const res = await PUT(req, { params: Promise.resolve({ id: 'code-pride' }) })
    expect(res.status).toBe(200)

    const payloadSentToUpdate = updateMock.mock.calls[0][0]
    expect(payloadSentToUpdate.percentage).toBeNull()
    expect(payloadSentToUpdate.is_active).toBe(false)
  })

  it('server enforcement: ignores explicit percentage in body for allowance-driven codes and forces percentage: null', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: adminUser }, error: null })

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'code-pride', code: 'PRIDE', percentage: null, uses_user_allowance: true, is_active: true },
            error: null
          })
        })
      })
    })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
            })
          })
        }
      }

      if (table === 'discount_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'code-pride', code: 'PRIDE', uses_user_allowance: true },
                error: null
              })
            }),
            neq: jest.fn().mockResolvedValue({ data: [], error: null })
          }),
          update: updateMock
        }
      }

      return {}
    })

    // Client maliciously/stale-ly sends percentage: 50
    const req = new NextRequest('http://localhost/api/admin/discount-codes/code-pride', {
      method: 'PUT',
      body: JSON.stringify({
        code: 'PRIDE',
        percentage: 50,
        is_active: true
      })
    })

    const res = await PUT(req, { params: Promise.resolve({ id: 'code-pride' }) })
    expect(res.status).toBe(200)

    // Verify API overrode the 50 in body with percentage: null
    const payloadSentToUpdate = updateMock.mock.calls[0][0]
    expect(payloadSentToUpdate.percentage).toBeNull()
  })

  it('enforces percentage validation for standard fixed-percentage codes', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: adminUser }, error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
            })
          })
        }
      }

      if (table === 'discount_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'code-fixed', code: 'PRIDE75', uses_user_allowance: false },
                error: null
              })
            })
          })
        }
      }

      return {}
    })

    // Send PUT without percentage on fixed code
    const req = new NextRequest('http://localhost/api/admin/discount-codes/code-fixed', {
      method: 'PUT',
      body: JSON.stringify({
        code: 'PRIDE75'
      })
    })

    const res = await PUT(req, { params: Promise.resolve({ id: 'code-fixed' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Valid percentage')
  })
})
