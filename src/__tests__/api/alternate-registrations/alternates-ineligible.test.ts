/**
 * Test for alternates list endpoint separating isIneligible vs isOverLimit
 */

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/services/discount-limit-service', () => ({
  resolveEffectiveDiscountLimitsBatch: jest.fn(),
  calculateSeasonalDiscountUsageBatch: jest.fn(),
  resolveDiscountPercentage: jest.fn(),
  evaluateSeasonalDiscountLimit: jest.fn()
}))

jest.mock('@/lib/utils/alternates-access', () => ({
  canAccessRegistrationAlternates: jest.fn().mockResolvedValue(true)
}))

jest.mock('@/lib/payment-method-utils', () => ({
  userHasValidPaymentMethod: jest.fn().mockReturnValue(true)
}))

import { GET } from '@/app/api/alternate-registrations/[gameId]/alternates/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessRegistrationAlternates } from '@/lib/utils/alternates-access'
import {
  resolveEffectiveDiscountLimitsBatch,
  calculateSeasonalDiscountUsageBatch,
  resolveDiscountPercentage
} from '@/lib/services/discount-limit-service'
import { NextRequest } from 'next/server'

type MockSupabaseClient = {
  auth: { getUser: jest.Mock }
  from: jest.Mock
}

type MockAdminSupabaseClient = {
  from: jest.Mock
}

describe('/api/alternate-registrations/[gameId]/alternates ineligible vs over-limit separation', () => {
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
    ;(canAccessRegistrationAlternates as jest.Mock).mockResolvedValue(true)
  })

  it('sets isIneligible: true and isOverLimit: false for ineligible users on gated categories', async () => {
    // 1. Game query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'game-1',
              registration_id: 'reg-1',
              registrations: {
                id: 'reg-1',
                season_id: 'season-1',
                alternate_price: 2000,
                allow_alternates: true
              }
            },
            error: null
          })
        })
      })
    })

    // 2. Alternates query on adminSupabase
    mockAdminSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'alt-1',
              user_id: 'user-ineligible',
              discount_code_id: 'code-gated',
              created_at: '2026-03-01T00:00:00Z',
              users: { id: 'user-ineligible', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
              discount_codes: {
                id: 'code-gated',
                code: 'FA50',
                percentage: null,
                category: { id: 'cat-gated', name: 'Financial Aid', max_discount_per_user_per_season: null }
              }
            }
          ],
          error: null
        })
      })
    })

    // 3. Alternate selections query on adminSupabase
    mockAdminSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: [], error: null })
      })
    })

    // Mock batch limit resolution returning isEligible: false for user-ineligible
    const effectiveMap = new Map()
    effectiveMap.set('user-ineligible:cat-gated', {
      maxAllowed: 0,
      percentage: null,
      isEligible: false,
      source: 'denied'
    })
    ;(resolveEffectiveDiscountLimitsBatch as jest.Mock).mockResolvedValue(effectiveMap)

    const usageMap = new Map()
    ;(calculateSeasonalDiscountUsageBatch as jest.Mock).mockResolvedValue(usageMap)
    ;(resolveDiscountPercentage as jest.Mock).mockReturnValue(null)

    const req = new NextRequest('http://localhost/api/alternate-registrations/game-1/alternates')
    const params = Promise.resolve({ gameId: 'game-1' })
    const res = await GET(req, { params })
    const data = await res.json()

    expect(data).toEqual(expect.objectContaining({ alternates: expect.any(Array) }))
    expect(res.status).toBe(200)
    expect(data.alternates).toHaveLength(1)
    expect(data.alternates[0].discountCode.isIneligible).toBe(true)
    expect(data.alternates[0].discountCode.isOverLimit).toBe(false)
    expect(data.alternates[0].discountCode.discountAmount).toBe(0)
  })
})
