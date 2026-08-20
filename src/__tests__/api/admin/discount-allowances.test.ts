/**
 * Tests for /api/admin/users/[id]/discount-allowances
 */

// Mock dependencies BEFORE imports
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logAdminAction: jest.fn()
  }
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/services/discount-limit-service', () => ({
  resolveEffectiveDiscountLimitsBatch: jest.fn(),
  calculateSeasonalDiscountUsageBatch: jest.fn()
}))

import { GET, PUT } from '@/app/api/admin/users/[id]/discount-allowances/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import {
  resolveEffectiveDiscountLimitsBatch,
  calculateSeasonalDiscountUsageBatch
} from '@/lib/services/discount-limit-service'
import { NextRequest } from 'next/server'

type MockSupabaseClient = {
  auth: { getUser: jest.Mock }
  from: jest.Mock
}

type MockAdminSupabaseClient = {
  from: jest.Mock
}

describe('/api/admin/users/[id]/discount-allowances', () => {
  let mockSupabase: MockSupabaseClient
  let mockAdminSupabase: MockAdminSupabaseClient

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

    mockAdminSupabase = {
      from: jest.fn()
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockReturnValue(mockAdminSupabase)
  })

  describe('GET', () => {
    it('returns 401 when unauthorized', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: new Error('Not authenticated')
      })

      const req = new NextRequest('http://localhost/api/admin/users/target-id/discount-allowances')
      const params = Promise.resolve({ id: 'target-id' })
      const res = await GET(req, { params })

      expect(res.status).toBe(401)
    })

    it('returns 403 when user is not admin', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { is_admin: false }, error: null })
          })
        })
      })

      const req = new NextRequest('http://localhost/api/admin/users/target-id/discount-allowances')
      const params = Promise.resolve({ id: 'target-id' })
      const res = await GET(req, { params })

      expect(res.status).toBe(403)
    })

    it('returns formatted allowances with resolved remaining and available options for active/upcoming seasons', async () => {
      // Mock admin check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
          })
        })
      })

      // Mock active seasons query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [
                { id: 'season-current', name: 'Spring 2026', start_date: '2026-03-01', end_date: '2026-12-31' }
              ],
              error: null
            })
          })
        })
      })

      // Mock user_discount_allowances query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'allowance-1',
                  user_id: 'target-id',
                  discount_category_id: 'cat-fa',
                  season_id: 'season-current',
                  discount_percentage: 50,
                  max_discount_amount: 25000,
                  notes: 'Financial aid 50%',
                  created_by: 'admin-id',
                  updated_by: 'admin-id',
                  created_at: '2026-03-01T00:00:00Z',
                  updated_at: '2026-03-01T00:00:00Z',
                  category: { id: 'cat-fa', name: 'Financial Aid', requires_user_allowance: true },
                  season: { id: 'season-current', name: 'Spring 2026', start_date: '2026-03-01', end_date: '2026-12-31' }
                }
              ],
              error: null
            })
          })
        })
      })

      // Mock all discount categories query for available options
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({
            data: [
              { id: 'cat-fa', name: 'Financial Aid' },
              { id: 'cat-bm', name: 'Board Member' }
            ],
            error: null
          })
        })
      })

      // Mock resolver and usage batch functions
      const effectiveMap = new Map()
      effectiveMap.set('target-id:cat-fa', {
        maxAllowed: 25000,
        percentage: 50,
        isEligible: true,
        source: 'user_allowance'
      })
      ;(resolveEffectiveDiscountLimitsBatch as jest.Mock).mockResolvedValue(effectiveMap)

      const usageMap = new Map()
      usageMap.get = jest.fn((key: string) => (key === 'target-id:cat-fa' ? 10000 : 0))
      ;(calculateSeasonalDiscountUsageBatch as jest.Mock).mockResolvedValue(usageMap)

      const req = new NextRequest('http://localhost/api/admin/users/target-id/discount-allowances')
      const params = Promise.resolve({ id: 'target-id' })
      const res = await GET(req, { params })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.allowances).toHaveLength(1)
      expect(data.allowances[0].remaining).toBe(15000) // $250 - $100 = $150 (15000 cents)
      expect(data.allowances[0].totalUsed).toBe(10000)
      expect(data.availableOptions).toHaveLength(1)
      expect(data.availableOptions[0].categoryId).toBe('cat-bm')
    })
  })

  describe('PUT', () => {
    it('validates discountPercentage (1-100 required)', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
          })
        })
      })

      const req = new NextRequest('http://localhost/api/admin/users/target-id/discount-allowances', {
        method: 'PUT',
        body: JSON.stringify({
          seasonId: 'season-current',
          categoryId: 'cat-fa',
          discountPercentage: 0, // invalid (must be >= 1)
          maxDiscountAmount: 25000
        })
      })
      const params = Promise.resolve({ id: 'target-id' })
      const res = await PUT(req, { params })

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('discountPercentage must be a number between 1 and 100')
    })

    it('rejects writes to past seasons (end_date < now)', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
          })
        })
      })

      // Mock season query returning a past season
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'season-past',
                name: 'Past Season 2020',
                end_date: '2020-12-31T23:59:59Z'
              },
              error: null
            })
          })
        })
      })

      const req = new NextRequest('http://localhost/api/admin/users/target-id/discount-allowances', {
        method: 'PUT',
        body: JSON.stringify({
          seasonId: 'season-past',
          categoryId: 'cat-fa',
          discountPercentage: 50,
          maxDiscountAmount: 25000
        })
      })
      const params = Promise.resolve({ id: 'target-id' })
      const res = await PUT(req, { params })

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Writes to past seasons are not allowed')
    })

    it('successfully upserts allowance, round-trips cents, and logs admin action with before/after values', async () => {
      // Mock admin check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
          })
        })
      })

      // Mock season query (current/upcoming)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'season-current',
                name: 'Spring 2026',
                end_date: '2026-12-31T23:59:59Z'
              },
              error: null
            })
          })
        })
      })

      // Mock existing row query (before value)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: 'allowance-1',
                    discount_percentage: 20,
                    max_discount_amount: 10000
                  },
                  error: null
                })
              })
            })
          })
        })
      })

      // Mock adminSupabase upsert
      const updatedRecord = {
        id: 'allowance-1',
        user_id: 'target-id',
        season_id: 'season-current',
        discount_category_id: 'cat-fa',
        discount_percentage: 50,
        max_discount_amount: 25000, // $250.00 in cents
        notes: 'Updated to 50%',
        created_by: 'admin-id',
        updated_by: 'admin-id',
        updated_at: '2026-03-01T00:00:00Z'
      }

      mockAdminSupabase.from.mockReturnValueOnce({
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: updatedRecord,
              error: null
            })
          })
        })
      })

      const req = new NextRequest('http://localhost/api/admin/users/target-id/discount-allowances', {
        method: 'PUT',
        body: JSON.stringify({
          seasonId: 'season-current',
          categoryId: 'cat-fa',
          discountPercentage: 50,
          maxDiscountAmount: 25000, // $250.00 in cents
          notes: 'Updated to 50%'
        })
      })
      const params = Promise.resolve({ id: 'target-id' })
      const res = await PUT(req, { params })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.allowance.max_discount_amount).toBe(25000)

      // Verify admin action log
      expect(logger.logAdminAction).toHaveBeenCalledWith(
        'discount-allowance-updated',
        'Discount allowance updated for user',
        expect.objectContaining({
          targetUserId: 'target-id',
          adminUserId: 'admin-id',
          before: expect.objectContaining({ discount_percentage: 20 }),
          after: expect.objectContaining({ discount_percentage: 50, max_discount_amount: 25000 })
        }),
        'info'
      )
    })
  })
})
