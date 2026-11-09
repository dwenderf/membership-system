import { requireAdmin } from '@/lib/auth/require-admin'

jest.mock('@/lib/supabase/server')

const getUser = jest.fn()
const single = jest.fn()
const client = {
  auth: { getUser },
  from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ single })) })) })),
}
jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(client))

describe('requireAdmin', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const result = await requireAdmin()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('returns 403 for a signed-in non-admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: { is_admin: false } })
    const result = await requireAdmin()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('returns 403 when the profile is missing', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: null })
    const result = await requireAdmin()
    expect(result.ok).toBe(false)
  })

  it('returns the user for an admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: { is_admin: true } })
    const result = await requireAdmin()
    expect(result).toEqual({ ok: true, user: { id: 'u1' } })
  })
})
