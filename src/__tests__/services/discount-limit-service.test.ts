/**
 * Tests for Discount Limit Service
 * Tests seasonal discount cap enforcement
 */

import {
  calculateSeasonalDiscountUsage,
  calculateSeasonalDiscountUsageBatch,
  evaluateSeasonalDiscountLimit,
  checkSeasonalDiscountLimit,
  getSeasonalDiscountUsageSummary,
  resolveEffectiveDiscountLimits,
  resolveEffectiveDiscountLimitsBatch,
  resolveDiscountPercentage
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

    mockSupabase = {
      from: jest.fn((table: string) => {
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: [], error: null })
                })
              })
            })
          }
        }
        return {}
      })
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
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
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
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: [], error: null })
                })
              })
            })
          }
        }
        return {}
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
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
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
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        if (table === 'discount_usage_computed') {
          return {
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
          }
        }
        return {}
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
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
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
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        if (table === 'discount_usage_computed') {
          return {
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
          }
        }
        return {}
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
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
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
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        if (table === 'discount_usage_computed') {
          return {
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
          }
        }
        return {}
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
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
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
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        if (table === 'discount_usage_computed') {
          return {
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
          }
        }
        return {}
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

  describe('Phase 1 Refactor Extensions', () => {
    it('should bypass seasonal cap when isRefund is true', async () => {
      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2500,
        { isRefund: true }
      )

      expect(result).toEqual({
        originalAmount: 2500,
        finalAmount: 2500,
        isPartialDiscount: false,
        isAtLimit: false
      })
      // Supabase should not be queried when isRefund is true
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('should set isAtLimit: true when user is at or over cap', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'code-1',
                    code: 'SUMMER20',
                    percentage: 20,
                    category: {
                      id: 'cat-1',
                      name: 'Summer',
                      max_discount_per_user_per_season: 5000
                    }
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        if (table === 'discount_usage_computed') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({
                    data: [{ amount_saved: 5000 }],
                    error: null
                  })
                })
              })
            })
          }
        }
        return {}
      })

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-1',
        'code-1',
        'season-1',
        1000
      )

      expect(result.finalAmount).toBe(0)
      expect(result.isAtLimit).toBe(true)
      expect(result.isPartialDiscount).toBe(false)
    })

    it('should set isAtLimit: false when maxAllowed is null or 0', async () => {
      const preFetchedCode = {
        id: 'code-1',
        code: 'NOCAP',
        percentage: 10,
        category: {
          id: 'cat-nocap',
          name: 'No Cap',
          max_discount_per_user_per_season: null
        }
      }

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-1',
        'code-1',
        'season-1',
        2000,
        { discountCode: preFetchedCode }
      )

      expect(result).toEqual({
        originalAmount: 2000,
        finalAmount: 2000,
        isPartialDiscount: false,
        isAtLimit: false
      })
      expect(mockSupabase.from).toHaveBeenCalledWith('user_discount_allowances')
    })

    it('should use pre-fetched discountCode with category: null as uncapped discount', async () => {
      const preFetchedCodeNullCat = {
        id: 'code-1',
        code: 'UNCATEGORIZED',
        percentage: 15,
        category: null
      }

      const result = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-1',
        'code-1',
        'season-1',
        1500,
        { discountCode: preFetchedCodeNullCat }
      )

      expect(result).toEqual({
        originalAmount: 1500,
        finalAmount: 1500,
        isPartialDiscount: false,
        isAtLimit: false
      })
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('calculateSeasonalDiscountUsageBatch should key usage map with colon separator (userId:categoryId)', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                { user_id: 'u1', discount_category_id: 'c1', amount_saved: 1000 },
                { user_id: 'u1', discount_category_id: 'c1', amount_saved: 500 },
                { user_id: 'u2', discount_category_id: 'c2', amount_saved: 2000 }
              ],
              error: null
            })
          })
        })
      })

      const map = await calculateSeasonalDiscountUsageBatch(
        mockSupabase,
        ['u1', 'u2'],
        'season-1'
      )

      expect(map.get('u1:c1')).toBe(1500)
      expect(map.get('u2:c2')).toBe(2000)
      expect(map.get('u1:c2')).toBeUndefined()
    })

    it('calculateSeasonalDiscountUsageBatch should throw if seasonId is missing', async () => {
      await expect(
        calculateSeasonalDiscountUsageBatch(mockSupabase, ['u1'], '')
      ).rejects.toThrow('Season ID is required for batch seasonal discount usage calculation')
    })

    it('evaluateSeasonalDiscountLimit should return exact 6-field usageStatus shape', () => {
      const category = {
        id: 'cat-1',
        name: 'Test Category',
        max_discount_per_user_per_season: 5000
      }

      const result = evaluateSeasonalDiscountLimit(category, 4000, 2000)

      expect(result.isOverLimit).toBe(true)
      expect(result.discountAmount).toBe(1000) // Capped at remaining 1000
      expect(result.usageStatus).toEqual({
        currentUsage: 4000,
        limit: 5000,
        wouldExceed: true,
        remainingAmount: 1000,
        requestedAmount: 2000,
        appliedAmount: 1000
      })
    })

    it('evaluateSeasonalDiscountLimit should handle null/unlimited category cleanly', () => {
      const resultNull = evaluateSeasonalDiscountLimit(null, 1000, 2000)
      expect(resultNull).toEqual({
        isOverLimit: false,
        discountAmount: 2000,
        usageStatus: null
      })

      const resultUnlimited = evaluateSeasonalDiscountLimit(
        { id: 'c1', name: 'Free', max_discount_per_user_per_season: null },
        1000,
        2000
      )
      expect(resultUnlimited).toEqual({
        isOverLimit: false,
        discountAmount: 2000,
        usageStatus: null
      })
    })
  })

  describe('Phase 2 Allowance Resolver (resolveEffectiveDiscountLimits)', () => {
    it('ungated category, no allowance -> returns category_default', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'cat-1',
                    name: 'Ungated Category',
                    requires_user_allowance: false,
                    max_discount_per_user_per_season: 5000,
                    default_percentage: '25.00'
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        return {}
      })

      const res = await resolveEffectiveDiscountLimits(mockSupabase, 'user-1', 'cat-1', 'season-1')
      expect(res).toEqual({
        maxAllowed: 5000,
        percentage: 25,
        isEligible: true,
        source: 'category_default'
      })
    })

    it('ungated category, allowance present -> user_allowance wins', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'cat-1',
                    name: 'Ungated Category',
                    requires_user_allowance: false,
                    max_discount_per_user_per_season: 5000,
                    default_percentage: 25
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({
                    data: {
                      discount_percentage: '50.00',
                      max_discount_amount: 10000
                    },
                    error: null
                  })
                })
              })
            })
          }
        }
        return {}
      })

      const res = await resolveEffectiveDiscountLimits(mockSupabase, 'user-1', 'cat-1', 'season-1')
      expect(res).toEqual({
        maxAllowed: 10000,
        percentage: 50,
        isEligible: true,
        source: 'user_allowance'
      })
    })

    it('gated category, no allowance -> isEligible: false, source: denied', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'cat-gated',
                    name: 'Financial Aid',
                    requires_user_allowance: true,
                    max_discount_per_user_per_season: null,
                    default_percentage: null
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          }
        }
        return {}
      })

      const res = await resolveEffectiveDiscountLimits(mockSupabase, 'user-1', 'cat-gated', 'season-1')
      expect(res).toEqual({
        maxAllowed: null,
        percentage: null,
        isEligible: false,
        source: 'denied'
      })
    })

    it('gated category, allowance with NULL discount_percentage -> inherits category default_percentage without NaN', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'cat-gated',
                    name: 'Financial Aid',
                    requires_user_allowance: true,
                    max_discount_per_user_per_season: 8000,
                    default_percentage: '30.00'
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({
                    data: {
                      discount_percentage: null,
                      max_discount_amount: null
                    },
                    error: null
                  })
                })
              })
            })
          }
        }
        return {}
      })

      const res = await resolveEffectiveDiscountLimits(mockSupabase, 'user-1', 'cat-gated', 'season-1')
      expect(res).toEqual({
        maxAllowed: 8000,
        percentage: 30,
        isEligible: true,
        source: 'user_allowance'
      })
    })

    it('max_discount_amount = 0 on allowance -> isEligible: false, source: denied (NOT unlimited)', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'cat-1',
                    name: 'Category',
                    requires_user_allowance: false,
                    max_discount_per_user_per_season: 5000,
                    default_percentage: 20
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({
                    data: {
                      discount_percentage: 20,
                      max_discount_amount: 0
                    },
                    error: null
                  })
                })
              })
            })
          }
        }
        return {}
      })

      const res = await resolveEffectiveDiscountLimits(mockSupabase, 'user-1', 'cat-1', 'season-1')
      expect(res).toEqual({
        maxAllowed: 0,
        percentage: 20,
        isEligible: false,
        source: 'denied'
      })
    })

    it('resolveEffectiveDiscountLimitsBatch returns entries for all user/category pairs and handles cache misses', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockResolvedValue({
              data: [
                { id: 'cat-1', name: 'Ungated', requires_user_allowance: false, max_discount_per_user_per_season: 5000, default_percentage: '25.00' },
                { id: 'cat-gated', name: 'Gated', requires_user_allowance: true, max_discount_per_user_per_season: 10000, default_percentage: '50.00' }
              ],
              error: null
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    { user_id: 'u1', discount_category_id: 'cat-gated', discount_percentage: '75.00', max_discount_amount: 15000 }
                  ],
                  error: null
                })
              })
            })
          }
        }
        return {}
      })

      const batchMap = await resolveEffectiveDiscountLimitsBatch(mockSupabase, ['u1', 'u2'], 'season-1')

      // u1 on cat-gated -> user_allowance
      expect(batchMap.get('u1:cat-gated')).toEqual({
        maxAllowed: 15000,
        percentage: 75,
        isEligible: true,
        source: 'user_allowance'
      })

      // u1 on cat-1 (miss) -> category_default
      expect(batchMap.get('u1:cat-1')).toEqual({
        maxAllowed: 5000,
        percentage: 25,
        isEligible: true,
        source: 'category_default'
      })

      // u2 on cat-gated (miss on gated) -> denied
      expect(batchMap.get('u2:cat-gated')).toEqual({
        maxAllowed: 10000,
        percentage: 50,
        isEligible: false,
        source: 'denied'
      })
    })

    it('isRefund: true bypasses eligibility check and cap for revoked allowances', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_codes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'dc-1',
                    code: 'PRIDE',
                    percentage: null,
                    uses_user_allowance: true,
                    category: {
                      id: 'cat-gated',
                      name: 'Financial Aid',
                      requires_user_allowance: true,
                      default_percentage: 50,
                      max_discount_per_user_per_season: null
                    }
                  },
                  error: null
                })
              })
            })
          }
        }
        return {}
      })

      const res = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-revoked',
        'dc-1',
        'season-1',
        5000,
        { isRefund: true }
      )

      expect(res.finalAmount).toBe(5000)
      expect(res.isPartialDiscount).toBe(false)
    })

    it('infrastructure query errors in resolveEffectiveDiscountLimits throw rather than returning denied', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'discount_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'cat-1', name: 'Category', requires_user_allowance: false, max_discount_per_user_per_season: 5000, default_percentage: 20 },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'user_discount_allowances') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Database connection failed' }
                  })
                })
              })
            })
          }
        }
        return {}
      })

      await expect(
        resolveEffectiveDiscountLimits(mockSupabase, 'user-1', 'cat-1', 'season-1')
      ).rejects.toThrow('Database connection failed')
    })
  })

  describe('resolveDiscountPercentage', () => {
    it('returns effectiveLimit.percentage for allowance-driven codes', () => {
      const discountCode = { percentage: null, uses_user_allowance: true }
      const effectiveLimit = { maxAllowed: 25000, percentage: 50, isEligible: true, source: 'user_allowance' as const }
      expect(resolveDiscountPercentage(discountCode, effectiveLimit)).toBe(50)
    })

    it('returns fixed code percentage for non-allowance codes even when allowance is present (D5)', () => {
      const discountCode = { percentage: 75, uses_user_allowance: false }
      const effectiveLimit = { maxAllowed: 25000, percentage: 50, isEligible: true, source: 'user_allowance' as const }
      expect(resolveDiscountPercentage(discountCode, effectiveLimit)).toBe(75)
    })

    it('returns 0 for resolved 0% codes quietly', () => {
      const discountCode = { percentage: 0, uses_user_allowance: false }
      const effectiveLimit = { maxAllowed: 25000, percentage: 50, isEligible: true, source: 'user_allowance' as const }
      expect(resolveDiscountPercentage(discountCode, effectiveLimit)).toBe(0)
    })

    it('returns null when percentage is unresolvable', () => {
      const discountCode = { percentage: null, uses_user_allowance: true }
      const effectiveLimit = { maxAllowed: null, percentage: null, isEligible: false, source: 'denied' as const }
      expect(resolveDiscountPercentage(discountCode, effectiveLimit)).toBeNull()
    })
  })

  describe('checkSeasonalDiscountLimit with pre-resolved options.effectiveLimit', () => {
    it('honors isEligible: false from pre-resolved effectiveLimit option', async () => {
      const preFetchedCode = {
        id: 'code-gated',
        code: 'PRIDE',
        percentage: null,
        uses_user_allowance: true,
        category: {
          id: 'cat-gated',
          name: 'Gated Category',
          max_discount_per_user_per_season: 5000,
          requires_user_allowance: true,
          default_percentage: 50
        }
      }

      const res = await checkSeasonalDiscountLimit(
        mockSupabase,
        'user-ineligible',
        'code-gated',
        'season-1',
        2500,
        {
          discountCode: preFetchedCode,
          effectiveLimit: {
            maxAllowed: 5000,
            percentage: 50,
            isEligible: false,
            source: 'denied'
          }
        }
      )

      expect(res.isEligible).toBe(false)
      expect(res.finalAmount).toBe(0)
    })
  })
})
