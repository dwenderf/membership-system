/**
 * Tests for Alternate Payment Service - Seasonal Discount Cap Enforcement
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

import { AlternatePaymentService } from '@/lib/services/alternate-payment-service'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'

describe('AlternatePaymentService - Seasonal Discount Caps', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Supabase client
    mockSupabase = {
      from: jest.fn()
    }
  })

  describe('calculateChargeAmount', () => {
    it('should apply full discount when under seasonal cap', async () => {
      // Mock registration query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                alternate_price: 5000 // $50
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
                percentage: 50, // 50% off
                usage_limit: null, // No per-code limit
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
        originalAmount: 2500,
        finalAmount: 2500, // Full discount allowed
        isPartialDiscount: false,
        seasonalUsage: {
          totalUsed: 1000,
          remaining: 4000,
          maxAllowed: 5000
        }
      })

      const result = await AlternatePaymentService.calculateChargeAmount(
        mockSupabase,
        'registration-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(2500) // $50 - $25 = $25
      expect(result.discountAmount).toBe(2500)
      expect(result.discountCode).toBeDefined()

      // Verify seasonal limit check was called
      expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2500
      )
    })

    it('should apply partial discount when approaching seasonal cap', async () => {
      // Mock registration query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                alternate_price: 5000 // $50
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
                percentage: 50, // 50% off = $25
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

      // Mock seasonal limit check - only $10 remaining
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 2500,
        finalAmount: 1000, // Only $10 remaining
        isPartialDiscount: true,
        partialDiscountMessage: 'Applied $10.00 discount...',
        seasonalUsage: {
          totalUsed: 4000,
          remaining: 1000,
          maxAllowed: 5000
        }
      })

      const result = await AlternatePaymentService.calculateChargeAmount(
        mockSupabase,
        'registration-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(4000) // $50 - $10 = $40
      expect(result.discountAmount).toBe(1000) // Only $10 applied
      expect(result.discountCode).toBeDefined()

      expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
        mockSupabase,
        'user-id',
        'code-id',
        'season-id',
        2500
      )
    })

    it('should apply no discount when seasonal cap is reached', async () => {
      // Mock registration query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                alternate_price: 5000 // $50
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
        originalAmount: 2500,
        finalAmount: 0, // No discount remaining
        isPartialDiscount: false,
        partialDiscountMessage: 'You have already reached your $50.00 season limit...',
        seasonalUsage: {
          totalUsed: 5000,
          remaining: 0,
          maxAllowed: 5000
        }
      })

      const result = await AlternatePaymentService.calculateChargeAmount(
        mockSupabase,
        'registration-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(5000) // Full price, no discount
      expect(result.discountAmount).toBe(0)
      expect(result.discountCode).toBeDefined()
    })

    it('should respect per-code usage limits before checking seasonal caps', async () => {
      // Mock registration query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                alternate_price: 5000 // $50
              },
              error: null
            })
          })
        })
      })

      // Mock discount code query - has usage_limit of 1
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-id',
                code: 'ONETIME',
                percentage: 100,
                usage_limit: 1, // Can only use once
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

      // Mock discount usage query - already used once
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'usage-1' }], // Already used 1 time
              error: null
            })
          })
        })
      })

      const result = await AlternatePaymentService.calculateChargeAmount(
        mockSupabase,
        'registration-id',
        'season-id',
        'code-id',
        'user-id'
      )

      expect(result.finalAmount).toBe(5000) // Full price
      expect(result.discountAmount).toBe(0) // No discount due to per-code limit
      expect(result.discountCode).toBeDefined()

      // Should NOT call seasonal limit check since per-code limit blocked it
      expect(checkSeasonalDiscountLimit).not.toHaveBeenCalled()
    })

    it('should handle no discount code gracefully', async () => {
      // Mock registration query
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                alternate_price: 5000 // $50
              },
              error: null
            })
          })
        })
      })

      const result = await AlternatePaymentService.calculateChargeAmount(
        mockSupabase,
        'registration-id',
        'season-id',
        undefined, // No discount code
        'user-id'
      )

      expect(result.finalAmount).toBe(5000) // Full price
      expect(result.discountAmount).toBe(0)
      expect(result.discountCode).toBeNull()
      expect(checkSeasonalDiscountLimit).not.toHaveBeenCalled()
    })

    it('should handle no user ID gracefully', async () => {
      // Mock registration query
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                alternate_price: 5000 // $50
              },
              error: null
            })
          })
        })
      })

      const result = await AlternatePaymentService.calculateChargeAmount(
        mockSupabase,
        'registration-id',
        'season-id',
        'code-id',
        undefined // No user ID
      )

      expect(result.finalAmount).toBe(5000) // Full price
      expect(result.discountAmount).toBe(0)
      expect(result.discountCode).toBeNull()
      expect(checkSeasonalDiscountLimit).not.toHaveBeenCalled()
    })

    it('should throw error when registration not found', async () => {
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
        AlternatePaymentService.calculateChargeAmount(
          mockSupabase,
          'invalid-id',
          'season-id',
          'code-id',
          'user-id'
        )
      ).rejects.toThrow('Registration not found')
    })
  })
})
