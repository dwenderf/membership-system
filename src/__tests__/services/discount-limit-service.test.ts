/**
 * Tests for Discount Limit Service
 * Tests seasonal discount cap enforcement
 */

import {
  calculateSeasonalDiscountUsage,
  checkSeasonalDiscountLimit,
  getSeasonalDiscountUsageSummary
} from '@/lib/services/discount-limit-service'

// Mock dependencies
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logPaymentProcessing: jest.fn()
  }
}))

describe('DiscountLimitService', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Supabase client
    mockSupabase = {
      from: jest.fn()
    }
  })

  describe('calculateSeasonalDiscountUsage', () => {
    it('should return 0 when no usage records exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          })
        })
      })

      const result = await calculateSeasonalDiscountUsage(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toBe(0)
    })

    it('should sum up all usage amounts for the user/category/season', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 1000 },
                  { amount_saved: 1500 },
                  { amount_saved: 500 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await calculateSeasonalDiscountUsage(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toBe(3000) // 1000 + 1500 + 500
    })

    it('should handle null amounts in usage records', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 1000 },
                  { amount_saved: null },
                  { amount_saved: 500 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await calculateSeasonalDiscountUsage(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toBe(1500) // 1000 + 0 + 500
    })

    it('should throw error when query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' }
              })
            })
          })
        })
      })

      await expect(
        calculateSeasonalDiscountUsage(
          mockSupabase,
          'user-id',
          'category-id',
          'season-id'
        )
      ).rejects.toThrow('Failed to query seasonal discount usage: Database error')
    })
  })

  describe('checkSeasonalDiscountLimit', () => {
    it('should allow full discount when no seasonal limit is set', async () => {
      // Mock discount code query - no max_discount_per_user_per_season
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50,
                category: {
                  id: 'category-id',
                  name: 'Test Category',
                  max_discount_per_user_per_season: null
                }
              },
              error: null
            })
          })
        })
      })

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2500 // Requesting $25 discount
      )

      expect(result.originalAmount).toBe(2500)
      expect(result.finalAmount).toBe(2500)
      expect(result.isPartialDiscount).toBe(false)
      expect(result.partialDiscountMessage).toBeUndefined()
    })

    it('should allow full discount when under seasonal cap', async () => {
      // Mock discount code query - has seasonal limit of $50
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50,
                category: {
                  id: 'category-id',
                  name: 'Test Category',
                  max_discount_per_user_per_season: 5000 // $50 cap
                }
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query - user has used $20 so far
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 1000 },
                  { amount_saved: 1000 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2000 // Requesting $20 discount
      )

      expect(result.originalAmount).toBe(2000)
      expect(result.finalAmount).toBe(2000)
      expect(result.isPartialDiscount).toBe(false)
      expect(result.seasonalUsage).toEqual({
        totalUsed: 2000,
        remaining: 3000,
        maxAllowed: 5000
      })
    })

    it('should apply partial discount when approaching seasonal cap', async () => {
      // Mock discount code query - has seasonal limit of $50
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50,
                category: {
                  id: 'category-id',
                  name: 'Test Category',
                  max_discount_per_user_per_season: 5000 // $50 cap
                }
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query - user has used $40 so far
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 2000 },
                  { amount_saved: 2000 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2000 // Requesting $20 discount, but only $10 remaining
      )

      expect(result.originalAmount).toBe(2000)
      expect(result.finalAmount).toBe(1000) // Only $10 remaining
      expect(result.isPartialDiscount).toBe(true)
      expect(result.partialDiscountMessage).toContain('Applied $10.00 discount')
      expect(result.partialDiscountMessage).toContain('you have $10.00 remaining')
      expect(result.partialDiscountMessage).toContain('$50.00 Test Category season limit')
      expect(result.seasonalUsage).toEqual({
        totalUsed: 4000,
        remaining: 1000,
        maxAllowed: 5000
      })
    })

    it('should apply no discount when seasonal cap is already reached', async () => {
      // Mock discount code query - has seasonal limit of $50
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50,
                category: {
                  id: 'category-id',
                  name: 'Test Category',
                  max_discount_per_user_per_season: 5000 // $50 cap
                }
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query - user has already used $50
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 2500 },
                  { amount_saved: 2500 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2000 // Requesting $20 discount, but $0 remaining
      )

      expect(result.originalAmount).toBe(2000)
      expect(result.finalAmount).toBe(0)
      expect(result.isPartialDiscount).toBe(false)
      expect(result.partialDiscountMessage).toContain('already reached your $50.00 season limit')
      expect(result.seasonalUsage).toEqual({
        totalUsed: 5000,
        remaining: 0,
        maxAllowed: 5000
      })
    })

    it('should apply no discount when seasonal cap is exceeded', async () => {
      // Mock discount code query - has seasonal limit of $50
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50,
                category: {
                  id: 'category-id',
                  name: 'Test Category',
                  max_discount_per_user_per_season: 5000 // $50 cap
                }
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query - user has used $60 (somehow exceeded)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 3000 },
                  { amount_saved: 3000 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2000
      )

      expect(result.originalAmount).toBe(2000)
      expect(result.finalAmount).toBe(0)
      expect(result.isPartialDiscount).toBe(false)
      expect(result.partialDiscountMessage).toContain('already reached your $50.00 season limit')
      expect(result.seasonalUsage).toEqual({
        totalUsed: 6000,
        remaining: 0,
        maxAllowed: 5000
      })
    })

    it('should throw error when discount code not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' }
            })
          })
        })
      })

      await expect(
        checkSeasonalDiscountLimit(
          mockSupabase,
          'user-id',
          'code-id',
          'season-id',
          2000
        )
      ).rejects.toThrow('Discount code not found')
    })
  })

  describe('getSeasonalDiscountUsageSummary', () => {
    it('should return null when no seasonal limit is set', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                max_discount_per_user_per_season: null
              },
              error: null
            })
          })
        })
      })

      const result = await getSeasonalDiscountUsageSummary(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toBeNull()
    })

    it('should return null when seasonal limit is 0', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                max_discount_per_user_per_season: 0
              },
              error: null
            })
          })
        })
      })

      const result = await getSeasonalDiscountUsageSummary(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toBeNull()
    })

    it('should return correct summary with remaining amount', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                max_discount_per_user_per_season: 5000 // $50 cap
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 2000 },
                  { amount_saved: 1500 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await getSeasonalDiscountUsageSummary(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toEqual({
        totalUsed: 3500,
        remaining: 1500,
        maxAllowed: 5000
      })
    })

    it('should return 0 remaining when at cap', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                max_discount_per_user_per_season: 5000 // $50 cap
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query - exactly at cap
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { amount_saved: 2500 },
                  { amount_saved: 2500 }
                ],
                error: null
              })
            })
          })
        })
      })

      const result = await getSeasonalDiscountUsageSummary(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toEqual({
        totalUsed: 5000,
        remaining: 0,
        maxAllowed: 5000
      })
    })

    it('should return null when category not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' }
            })
          })
        })
      })

      const result = await getSeasonalDiscountUsageSummary(
        mockSupabase,
        'user-id',
        'category-id',
        'season-id'
      )

      expect(result).toBeNull()
    })
  })
})
