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

type MockSupabaseClient = {
  auth: { getUser: jest.Mock }
  from: jest.Mock
}

const mockSupabase: MockSupabaseClient = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))

describe('/api/validate-discount-code POST', () => {
  beforeEach(() => {
    jest.clearAllMocks()

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
      return {}
    })
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

    // xero_invoices query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ id: 'inv-1' }],
              error: null
            })
          })
        })
      })
    })

    // xero_invoice_line_items query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'item-1', line_amount: -2000 }],
              error: null
            })
          })
        })
      })
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUMMER20', registrationId: 'reg-1', paymentId: 'pay-1', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(2000)
  })

  it('should return neutral error message when user is ineligible (limitResult.isEligible === false)', async () => {
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
                id: 'code-pride',
                code: 'PRIDE',
                percentage: null,
                uses_user_allowance: true,
                is_active: true,
                discount_categories: {
                  id: 'cat-financial-aid',
                  name: 'Financial Aid',
                  accounting_code: 'ACC400',
                  max_discount_per_user_per_season: null,
                  requires_user_allowance: true,
                  default_percentage: 50,
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
      originalAmount: 5000,
      finalAmount: 0,
      isPartialDiscount: false,
      isAtLimit: false,
      isEligible: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRIDE', registrationId: 'reg-1', amount: 10000 })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(false)
    expect(data.error).toBe("This code isn't available to your account.")
  })

  it('should resolve original ACCREC invoice line item for refund and ignore ACCRECCREDIT credit notes', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    // Registration query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // Discount code query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-1',
                code: 'SUMMER20',
                percentage: 20,
                uses_user_allowance: false,
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

    // xero_invoices query (filtering by ACCREC and sync_status IN ('synced', 'pending'))
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ id: 'inv-accrec-original' }],
              error: null
            })
          })
        })
      })
    })

    // xero_invoice_line_items query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'item-1', line_amount: -4000 }],
              error: null
            })
          })
        })
      })
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUMMER20', registrationId: 'reg-1', paymentId: 'pay-1', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(4000)
  })

  it('should ignore abandoned staged ACCREC invoices and resolve synced ACCREC invoice for refund', async () => {
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
                uses_user_allowance: false,
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

    // xero_invoices query returns only the single synced invoice when filtering sync_status in ['synced', 'pending']
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ id: 'inv-synced-1' }],
              error: null
            })
          })
        })
      })
    })

    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'item-1', line_amount: -3500 }],
              error: null
            })
          })
        })
      })
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUMMER20', registrationId: 'reg-1', paymentId: 'pay-1', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(3500)
  })

  it('should deny retroactive refund application for allowance-driven code when customer has no allowance', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })

    // 1. registrations query (no user_id column - registrations is the season/event template)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // 2. discount_codes query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-pride',
                code: 'PRIDE',
                percentage: null,
                uses_user_allowance: true,
                is_active: true,
                discount_categories: {
                  id: 'cat-financial-aid',
                  name: 'Financial Aid',
                  accounting_code: 'ACC400',
                  max_discount_per_user_per_season: null,
                  requires_user_allowance: true,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    // 3. xero_invoices returns no invoice
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          })
        })
      })
    })

    // 4. payments query resolves the paying customer
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { user_id: 'customer-1' }, error: null })
        })
      })
    })

    // 5. user_discount_allowances lookup for the customer returns no row (falls back to beforeEach default: [])

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRIDE', registrationId: 'reg-1', paymentId: 'pay-missing', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(false)
    expect(data.error).toBe("This code isn't available to this customer's account.")
  })

  it('should retroactively apply allowance-driven code during refund when customer has an eligible allowance', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })

    // 1. registrations query (no user_id column - registrations is the season/event template)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // 2. discount_codes query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-pride',
                code: 'PRIDE',
                percentage: null,
                uses_user_allowance: true,
                is_active: true,
                discount_categories: {
                  id: 'cat-financial-aid',
                  name: 'Financial Aid',
                  accounting_code: 'ACC400',
                  max_discount_per_user_per_season: null,
                  requires_user_allowance: true,
                  default_percentage: null,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    // 3. xero_invoices returns no invoice (code was never applied at checkout)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          })
        })
      })
    })

    // 4. payments query resolves the paying customer
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { user_id: 'customer-1' }, error: null })
        })
      })
    })

    // 5. user_discount_allowances query - customer has a 60% allowance
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ discount_percentage: 60, max_discount_amount: null }],
              error: null
            })
          })
        })
      })
    })

    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 6000,
      finalAmount: 6000,
      isPartialDiscount: false,
      isAtLimit: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRIDE', registrationId: 'reg-1', paymentId: 'pay-missing', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(6000) // 60% of $100.00 payment
    expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
      expect.anything(),
      'customer-1', // eligibility resolved for the paying customer, not the admin
      'code-pride',
      'season-1',
      6000,
      expect.objectContaining({ isRefund: false })
    )
  })

  it('should cap retroactive refund application at the customer\'s remaining season limit', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })

    // 1. registrations query (no user_id column - registrations is the season/event template)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // 2. discount_codes query (100% allowance code, e.g. would normally discount the full $100 payment)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-pride',
                code: 'PRIDEAID',
                percentage: null,
                uses_user_allowance: true,
                is_active: true,
                discount_categories: {
                  id: 'cat-financial-aid',
                  name: 'Financial Aid',
                  accounting_code: 'ACC400',
                  max_discount_per_user_per_season: 2500,
                  requires_user_allowance: true,
                  default_percentage: null,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    // 3. xero_invoices returns no invoice (code was never applied at checkout)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          })
        })
      })
    })

    // 4. payments query resolves the paying customer
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { user_id: 'customer-1' }, error: null })
        })
      })
    })

    // 5. user_discount_allowances query - customer has a 100% allowance, capped at $25 for the season
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ discount_percentage: 100, max_discount_amount: 2500 }],
              error: null
            })
          })
        })
      })
    })

    // Customer has already used $0 of their $25 cap this season, but the requested $100 discount exceeds it
    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 10000,
      finalAmount: 2500,
      isPartialDiscount: true,
      isAtLimit: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRIDEAID', registrationId: 'reg-1', paymentId: 'pay-missing', amount: 10000, isRefund: true })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(2500) // capped at remaining $25, not the full $100 discount
    expect(data.isPartialDiscount).toBe(true)
    expect(data.partialDiscountMessage).toBeTruthy()
  })

  it('should resolve percentage from allowance for allowance-driven code and calculate requested amount before cap check', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-allowance' } }, error: null })

    // 1. user_registrations query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // 2. discount_codes query (uses_user_allowance = true, percentage = null)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-pride',
                code: 'PRIDE',
                percentage: null,
                uses_user_allowance: true,
                is_active: true,
                discount_categories: {
                  id: 'cat-aid',
                  name: 'Financial Aid',
                  accounting_code: 'ACC500',
                  max_discount_per_user_per_season: null,
                  requires_user_allowance: true,
                  default_percentage: 50,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    // 3. user_discount_allowances query (user has 50% allowance)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ discount_percentage: 50, max_discount_amount: 25000 }],
              error: null
            })
          })
        })
      })
    })

    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 50000,
      finalAmount: 25000, // Capped at $250
      isPartialDiscount: true,
      isAtLimit: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRIDE', registrationId: 'reg-1', amount: 100000 }) // $1,000 purchase
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountCode.percentage).toBe(50) // Effective percentage reported in UI
    expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
      expect.anything(),
      'user-allowance',
      'code-pride',
      'season-1',
      50000, // $500 requested (50% of $1,000), NOT $0!
      expect.objectContaining({ isRefund: false })
    )
  })

  it('should preserve fixed code percentage when user has an allowance (D5 scenario)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-d5' } }, error: null })

    // 1. user_registrations query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { season_id: 'season-1' }, error: null })
        })
      })
    })

    // 2. discount_codes query (fixed 75% code)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'code-pride75',
                code: 'PRIDE75',
                percentage: 75,
                uses_user_allowance: false,
                is_active: true,
                discount_categories: {
                  id: 'cat-aid',
                  name: 'Financial Aid',
                  accounting_code: 'ACC500',
                  max_discount_per_user_per_season: null,
                  requires_user_allowance: false,
                  default_percentage: 50,
                  is_active: true
                }
              },
              error: null
            })
          })
        })
      })
    })

    // 3. user_discount_allowances query (user has 50% allowance row)
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ discount_percentage: 50, max_discount_amount: 100000 }],
              error: null
            })
          })
        })
      })
    })

    ;(checkSeasonalDiscountLimit as jest.Mock).mockResolvedValue({
      originalAmount: 75000,
      finalAmount: 75000,
      isPartialDiscount: false,
      isAtLimit: false
    })

    const request = new NextRequest('http://localhost/api/validate-discount-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'PRIDE75', registrationId: 'reg-1', amount: 100000 })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isValid).toBe(true)
    expect(data.discountCode.percentage).toBe(75) // Fixed percentage (75%), NOT allowance percentage (50%)!
    expect(checkSeasonalDiscountLimit).toHaveBeenCalledWith(
      expect.anything(),
      'user-d5',
      'code-pride75',
      'season-1',
      75000, // 75% of $1,000
      expect.objectContaining({ isRefund: false })
    )
  })
})
