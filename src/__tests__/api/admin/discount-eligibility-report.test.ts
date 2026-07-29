/**
 * Unit test suite for GET /api/admin/reports/discount-eligibility
 */

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn()
}))

jest.mock('@/lib/services/discount-limit-service', () => ({
  resolveEffectiveDiscountLimitsBatch: jest.fn(),
  calculateSeasonalDiscountUsageBatch: jest.fn()
}))

import { GET } from '@/app/api/admin/reports/discount-eligibility/route'
import { createClient } from '@/lib/supabase/server'
import {
  resolveEffectiveDiscountLimitsBatch,
  calculateSeasonalDiscountUsageBatch
} from '@/lib/services/discount-limit-service'
import { NextRequest } from 'next/server'

describe('/api/admin/reports/discount-eligibility', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'admin-id' } },
          error: null
        })
      },
      from: jest.fn()
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  it('returns 401 when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Auth required') })
    const req = new NextRequest('http://localhost/api/admin/reports/discount-eligibility')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { is_admin: false }, error: null })
        })
      })
    })

    const req = new NextRequest('http://localhost/api/admin/reports/discount-eligibility')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns formatted eligibility list including users with zero usage and 2-state source badge', async () => {
    // 1. Admin check
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
        })
      })
    })

    // 2. Seasons query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({
          data: [
            { id: 'season-current', name: 'Spring 2026', start_date: '2026-03-01', end_date: '2026-12-31' }
          ],
          error: null
        })
      })
    })

    // 3. User discount allowances query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'allowance-active',
              user_id: 'user-zero-usage',
              discount_category_id: 'cat-fa',
              season_id: 'season-current',
              discount_percentage: 50,
              max_discount_amount: 25000,
              notes: 'Active allowance with 0 usage',
              created_at: '2026-03-01T00:00:00Z',
              updated_at: '2026-03-01T00:00:00Z',
              user: { id: 'user-zero-usage', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', member_id: 'M100' },
              category: { id: 'cat-fa', name: 'Financial Aid', requires_user_allowance: true }
            },
            {
              id: 'allowance-revoked',
              user_id: 'user-revoked',
              discount_category_id: 'cat-fa',
              season_id: 'season-current',
              discount_percentage: 50,
              max_discount_amount: 0,
              notes: 'Revoked allowance',
              created_at: '2026-03-01T00:00:00Z',
              updated_at: '2026-03-01T00:00:00Z',
              user: { id: 'user-revoked', first_name: 'Bob', last_name: 'Jones', email: 'bob@example.com', member_id: 'M101' },
              category: { id: 'cat-fa', name: 'Financial Aid', requires_user_allowance: true }
            }
          ],
          error: null
        })
      })
    })

    // Batch mocks
    const effectiveMap = new Map()
    effectiveMap.set('user-zero-usage:cat-fa', {
      maxAllowed: 25000,
      percentage: 50,
      isEligible: true,
      source: 'user_allowance'
    })
    effectiveMap.set('user-revoked:cat-fa', {
      maxAllowed: 0,
      percentage: null,
      isEligible: false,
      source: 'denied'
    })
    ;(resolveEffectiveDiscountLimitsBatch as jest.Mock).mockResolvedValue(effectiveMap)

    const usageMap = new Map()
    // Notice user-zero-usage is NOT in usageMap -> map lookup miss = 0 usage
    ;(calculateSeasonalDiscountUsageBatch as jest.Mock).mockResolvedValue(usageMap)

    const req = new NextRequest('http://localhost/api/admin/reports/discount-eligibility?seasonId=season-current')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.eligibility).toHaveLength(2)

    // Check user with zero usage
    const activeRow = data.eligibility.find((r: any) => r.userId === 'user-zero-usage')
    expect(activeRow).toBeDefined()
    expect(activeRow.totalUsed).toBe(0)
    expect(activeRow.remaining).toBe(25000)
    expect(activeRow.source).toBe('user_allowance')
    expect(activeRow.isRevoked).toBe(false)

    // Check revoked user
    const revokedRow = data.eligibility.find((r: any) => r.userId === 'user-revoked')
    expect(revokedRow).toBeDefined()
    expect(revokedRow.remaining).toBe(0)
    expect(revokedRow.source).toBe('denied')
    expect(revokedRow.isRevoked).toBe(true)
  })
})
