/**
 * Tests for Waitlist Payment Service - Seasonal Discount Cap Enforcement
 */

// Set mock env vars before imports
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_123'
process.env.STRIPE_API_VERSION = '2023-10-16'

// Mock dependencies BEFORE imports
jest.mock('stripe', () => {
  class MockStripe {
    paymentIntents = {
      create: jest.fn().mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' })
    }
  }
  return Object.assign(MockStripe, { default: MockStripe, __esModule: true })
})

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

jest.mock('@/lib/services/discount-limit-service', () => {
  const actual = jest.requireActual('@/lib/services/discount-limit-service')
  return {
    ...actual,
    checkSeasonalDiscountLimit: jest.fn()
  }
})

jest.mock('@/lib/xero/staging', () => ({
  xeroStagingManager: {
    createImmediateStaging: jest.fn().mockResolvedValue({ id: 'staging-1' })
  },
  StagingPaymentData: {}
}))

jest.mock('@/lib/payment-completion-processor', () => ({
  PaymentCompletionProcessor: jest.fn()
}))



jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

import { WaitlistPaymentService } from '@/lib/services/waitlist-payment-service'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'
import { createClient, createAdminClient } from '@/lib/supabase/server'

describe('WaitlistPaymentService - Seasonal Discount Caps', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Supabase client with default fallback for user_discount_allowances
    mockSupabase = {
      from: jest.fn((table?: string) => {
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

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockReturnValue(mockSupabase)
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
        5000,
        { effectiveLimit: expect.anything() }
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
      mockSupabase.from.mockImplementation((table: string) => {
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
        if (table === 'discount_usage_computed') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [{ id: 'usage-1' }, { id: 'usage-2' }], // Already used 2 times
                  error: null
                })
              })
            })
          }
        }
        return {}
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

  describe('Percentage Resolution & Allowance Extensions', () => {
    it('override price with an allowance row computes discount against the override price, not category price', async () => {
      // Mock Supabase queries by table name
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'registrations') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'registration-id',
                    user_id: 'user-id',
                    registration_category_id: 'cat-id',
                    season_id: 'season-id',
                    discount_code_id: 'code-pride',
                    status: 'waitlisted',
                    payment_status: 'unpaid',
                    registration_categories: {
                      id: 'cat-id',
                      price: 10000 // Category price = $100.00
                    }
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'registration_categories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'cat-id', price: 10000, accounting_code: 'ACC100' },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'users') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'user-id',
                    stripe_customer_id: 'cus_123',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded'
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'discount_codes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'code-pride',
                    code: 'PRIDE',
                    percentage: null,
                    uses_user_allowance: true,
                    usage_limit: null,
                    category: {
                      id: 'cat-id',
                      name: 'Financial Aid',
                      requires_user_allowance: false,
                      default_percentage: 20,
                      accounting_code: 'DISC200'
                    }
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'xero_invoices') {
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null })
            })
          }
        }
        if (table === 'payments') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'payment-1' },
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
                    data: [
                      {
                        user_id: 'user-id',
                        discount_category_id: 'cat-id',
                        season_id: 'season-id',
                        discount_percentage: 50,
                        max_discount_amount: null
                      }
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

      // Mock seasonal limit check - allow full discount
      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 4000,
        finalAmount: 4000,
        isPartialDiscount: false
      })

      // Charge waitlist user with override price of $80.00 (8000 cents)
      const res = await WaitlistPaymentService.chargeWaitlistUser(
        'user-id',
        'registration-id',
        'cat-id',
        'Financial Aid',
        'code-pride',
        8000
      )

      expect(res.success).toBe(true)
      // Base price was $80 (8000), 50% allowance discount = $40 (4000), NOT 50% of category price $100 (5000)
      expect(res.amountCharged).toBe(4000)
    })

    it('allowance-driven code resolves percentage from allowance row', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'cat-id', price: 10000 },
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
                id: 'code-pride',
                code: 'PRIDE',
                percentage: null,
                uses_user_allowance: true,
                usage_limit: null,
                category: {
                  id: 'cat-id',
                  name: 'Financial Aid',
                  requires_user_allowance: false,
                  default_percentage: 20
                }
              },
              error: null
            })
          })
        })
      })

      // Mock allowance query (50% allowance)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ discount_percentage: 50, max_discount_amount: null }],
                error: null
              })
            })
          })
        })
      })

      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 5000,
        finalAmount: 5000,
        isPartialDiscount: false
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'cat-id',
        'season-id',
        'code-pride',
        'user-id'
      )

      expect(result.discountAmount).toBe(5000) // 50% of $100.00
    })

    it('D5 fixed code with allowance preserves fixed code percentage', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'cat-id', price: 10000 },
              error: null
            })
          })
        })
      })

      // Mock discount code query (fixed 75%)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-fixed75',
                code: 'FIXED75',
                percentage: 75,
                uses_user_allowance: false,
                usage_limit: null,
                category: {
                  id: 'cat-id',
                  name: 'Financial Aid',
                  requires_user_allowance: false,
                  default_percentage: 50
                }
              },
              error: null
            })
          })
        })
      })

      // Mock allowance query (50% allowance)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ discount_percentage: 50, max_discount_amount: null }],
                error: null
              })
            })
          })
        })
      })

      ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
        originalAmount: 7500,
        finalAmount: 7500,
        isPartialDiscount: false
      })

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'cat-id',
        'season-id',
        'code-fixed75',
        'user-id'
      )

      expect(result.discountAmount).toBe(7500) // 75% of $100.00 (code percentage preserved per D5)
    })

    it('ineligible user for gated category gets zero discount and logs warning', async () => {
      // Mock category query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'cat-gated', price: 10000 },
              error: null
            })
          })
        })
      })

      // Mock discount code query on gated category
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-gated',
                code: 'GATED',
                percentage: null,
                uses_user_allowance: true,
                usage_limit: null,
                category: {
                  id: 'cat-gated',
                  name: 'Gated Category',
                  requires_user_allowance: true,
                  default_percentage: 50
                }
              },
              error: null
            })
          })
        })
      })

      // Mock allowance query (no allowance row)
      mockSupabase.from.mockReturnValueOnce({
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

      const result = await WaitlistPaymentService.calculateChargeAmount(
        mockSupabase,
        'cat-gated',
        'season-id',
        'code-gated',
        'user-ineligible'
      )

      expect(result.discountAmount).toBe(0)
    })
  })
})
