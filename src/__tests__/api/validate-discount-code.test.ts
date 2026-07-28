/**
 * Unit tests for /api/validate-discount-code route
 * Verifies discount limit consolidation through checkSeasonalDiscountLimit
 */

import { POST } from '@/app/api/validate-discount-code/route'
import { NextRequest } from 'next/server'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'

// Mock dependencies
jest.mock('@/lib/supabase/server')
jest.mock('@/lib/services/discount-limit-service', () => {
  const original = jest.requireActual('@/lib/services/discount-limit-service')
  return {
    ...original,
    checkSeasonalDiscountLimit: jest.fn()
  }
})

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn()
  }))
}

require('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))

describe('/api/validate-discount-code POST', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should require authentication', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Unauthorized' } })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'DISCOUNT10', registrationId: 'reg-1', amount: 10000 })
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should return isValid: true when seasonal limit is not exceeded', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    // Mock registration lookup
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // Mock discount code query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-1',
                code: 'SUMMER20',
                percentage: 20,
                is_active: true,
                discount_categories: {
                  id: 'cat-1',
                  name: 'Summer Discounts',
                  accounting_code: 'ACC123',
                  max_discount_per_user_per_season: 5000,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    // Mock checkSeasonalDiscountLimit
    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 2000,
      finalAmount: 2000,
      isPartialDiscount: false,
      isAtLimit: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUMMER20', registrationId: 'reg-1', amount: 10000 })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(2000)
    expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'code-1',
      'season-1',
      2000,
      expect.objectContaining({ isRefund: false })
    )
  })

  it('should return isValid: false hard rejection when user is at seasonal limit', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-1',
                code: 'SUMMER20',
                percentage: 20,
                is_active: true,
                discount_categories: {
                  id: 'cat-1',
                  name: 'Summer Discounts',
                  accounting_code: 'ACC123',
                  max_discount_per_user_per_season: 5000,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 2000,
      finalAmount: 0,
      isPartialDiscount: false,
      isAtLimit: true
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUMMER20', registrationId: 'reg-1', amount: 10000 })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(false)
    expect(data.error).toBe('You have already reached your $50.00 season limit for Summer Discounts. No additional discount can be applied.')
  })

  it('should pass isRefund: true to service and return full discount when isRefund is true', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-1',
                code: 'SUMMER20',
                percentage: 20,
                is_active: true,
                discount_categories: {
                  id: 'cat-1',
                  name: 'Summer Discounts',
                  accounting_code: 'ACC123',
                  max_discount_per_user_per_season: 5000,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 2000,
      finalAmount: 2000,
      isPartialDiscount: false,
      isAtLimit: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUMMER20', registrationId: 'reg-1', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(2000)
    expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'code-1',
      'season-1',
      2000,
      expect.objectContaining({ isRefund: true })
    )
  })
})
