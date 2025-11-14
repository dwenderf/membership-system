/**
 * Tests for Waitlist Payment Service - Seasonal Discount Cap Enforcement
 */

// Mock dependencies BEFORE imports
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logPaymentProcessing: jest.fn()
  },
  Logger: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    })
  }
}))

jest.mock('@/lib/services/discount-limit-service', () => ({
  checkSeasonalDiscountLimit: jest.fn()
}))

jest.mock('@/lib/xero/staging', () => ({
  xeroStagingManager: {},
  StagingPaymentData: {}
}))

jest.mock('@/lib/payment-completion-processor', () => ({
  PaymentCompletionProcessor: jest.fn()
}))

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({}))
})

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

import { WaitlistPaymentService } from '@/lib/services/waitlist-payment-service'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'

describe('WaitlistPaymentService - Seasonal Discount Caps', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Supabase client
    mockSupabase = {
      from: jest.fn()
    }
  })

  describe('calculateChargeAmount - Normal Flow', () => {
    it('should apply full discount when under seasonal cap', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 10000 // $100
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50, // 50% off = $50
                usage_limit: null,
                category: {
                  id: 'category-id',
                  name: 'Test Category'
                }
              },
              error: null
            })
          })
        })
      })

      // Mock seasonal limit check - allow full discount
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 5000,
        finalAmount: 5000, // Full discount allowed
        isPartialDiscount: false,
        seasonalUsage: {
          totalUsed: 2000,
          remaining: 3000,
          maxAllowed: 5000
        }
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(5000) // $100 - $50 = $50
      expect(result.discountAmount).toBe(5000)
      expect(result.discountCode).toBeDefined()

      // Verify seasonal limit check was called
      expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        5000
      )
    })

    it('should apply partial discount when approaching seasonal cap', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 10000 // $100
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50, // 50% off = $50
                usage_limit: null,
                category: {
                  id: 'category-id',
                  name: 'Test Category'
                }
              },
              error: null
            })
          })
        })
      })

      // Mock seasonal limit check - only $20 remaining
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 5000,
        finalAmount: 2000, // Only $20 remaining
        isPartialDiscount: true,
        partialDiscountMessage: 'Applied $20.00 discount...',
        seasonalUsage: {
          totalUsed: 3000,
          remaining: 2000,
          maxAllowed: 5000
        }
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(8000) // $100 - $20 = $80
      expect(result.discountAmount).toBe(2000) // Only $20 applied
      expect(result.discountCode).toBeDefined()
    })

    it('should apply no discount when seasonal cap is reached', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 10000 // $100
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TEST50',
                percentage: 50,
                usage_limit: null,
                category: {
                  id: 'category-id',
                  name: 'Test Category'
                }
              },
              error: null
            })
          })
        })
      })

      // Mock seasonal limit check - already at cap
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 5000,
        finalAmount: 0, // No discount remaining
        isPartialDiscount: false,
        partialDiscountMessage: 'You have already reached your $50.00 season limit...',
        seasonalUsage: {
          totalUsed: 5000,
          remaining: 0,
          maxAllowed: 5000
        }
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(10000) // Full price, no discount
      expect(result.discountAmount).toBe(0)
      expect(result.discountCode).toBeDefined()
    })

    it('should respect per-code usage limits before checking seasonal caps', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 10000 // $100
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query - has usage_limit of 2
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TWOTIMER',
                percentage: 100,
                usage_limit: 2, // Can only use twice
                category: {
                  id: 'category-id',
                  name: 'Test Category'
                }
              },
              error: null
            })
          })
        })
      })

      // Mock discount usage query - already used twice
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'usage-1' }, { id: 'usage-2' }], // Already used 2 times
              error: null
            })
          })
        })
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(10000) // Full price
      expect(result.discountAmount).toBe(0) // No discount due to per-code limit
      expect(result.discountCode).toBeDefined()

      // Should NOT call seasonal limit check since per-code limit blocked it
      expect(checkSeasonalDiscountLimit).not.toHaveBeenCalled()
    })

    it('should handle no discount code gracefully', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 10000 // $100
              },
              error: null
            })
          })
        })
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        undefined, // No discount code
        'user-id'
      )

      expect(result.finalAmount).toBe(10000) // Full price
      expect(result.discountAmount).toBe(0)
      expect(result.discountCode).toBeNull()
      expect(checkSeasonalDiscountLimit).not.toHaveBeenCalled()
    })

    it('should throw error when category not found', async () => {
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
        WaitlistPaymentService.calculateChargeAmount(
          mockSupabase,
          'invalid-id',
          'season-id',
          'code-id',
          'user-id'
        )
      ).rejects.toThrow('Registration category not found')
    })
  })

  describe('Edge Cases', () => {
    it('should handle 100% discount code with seasonal caps', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 10000 // $100
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query - 100% off
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'FREE100',
                percentage: 100, // 100% off = $100
                usage_limit: null,
                category: {
                  id: 'category-id',
                  name: 'Test Category'
                }
              },
              error: null
            })
          })
        })
      })

      // Mock seasonal limit check - only $50 remaining of $100 cap
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 10000, // Requesting $100 discount
        finalAmount: 5000, // Only $50 remaining
        isPartialDiscount: true,
        partialDiscountMessage: 'Applied $50.00 discount...',
        seasonalUsage: {
          totalUsed: 5000,
          remaining: 5000,
          maxAllowed: 10000
        }
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(5000) // $100 - $50 = $50 (not free!)
      expect(result.discountAmount).toBe(5000) // Only $50 discount applied
      expect(result.discountCode).toBeDefined()
    })

    it('should handle very small discount amounts correctly', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                price: 100 // $1.00
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query - 10% off
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'TINY10',
                percentage: 10, // 10% of $1.00 = $0.10
                usage_limit: null,
                category: {
                  id: 'category-id',
                  name: 'Test Category'
                }
              },
              error: null
            })
          })
        })
      })

      // Mock seasonal limit check - allow full discount
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 10, // $0.10
        finalAmount: 10, // Full discount allowed
        isPartialDiscount: false
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'category-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(90) // $1.00 - $0.10 = $0.90
      expect(result.discountAmount).toBe(10)
    })
  })
})
