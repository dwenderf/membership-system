/**
 * Non-tautological integration tests for Cross-Path Discount Consistency
 * Verifies that GET /api/alternate-registrations/[gameId]/alternates and
 * AlternatePaymentService.calculateChargeAmount compute identical dollar discounts
 * end-to-end when backed by identical underlying DB state.
 */

import { GET } from '@/app/api/alternate-registrations/[gameId]/alternates/route'
import { AlternatePaymentService } from '@/lib/services/alternate-payment-service'
import { NextRequest } from 'next/server'

// Mock Supabase Server Clients
const mockSupabase: any = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' })
    }
  }))
})

// Mock Logging
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logPaymentProcessing: jest.fn(),
    logSystem: jest.fn()
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

jest.mock('@/lib/utils/alternates-access', () => ({
  canAccessRegistrationAlternates: jest.fn().mockResolvedValue(true)
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
  createAdminClient: jest.fn(() => mockSupabase)
}))

describe('Cross-Path Discount Consistency (Alternates List vs Alternate Charge)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-admin' } }, error: null })
  })

  it('fixed code with allowance row (D5) produces identical discount on both paths', async () => {
    const userId = 'user-d5'
    const gameId = 'game-1'
    const registrationId = 'reg-1'
    const seasonId = 'season-1'
    const discountCodeId = 'code-pride75'

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'alternate_registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: gameId,
                  registration_id: registrationId,
                  game_description: 'Game 1',
                  game_date: '2026-08-01',
                  registrations: {
                    id: registrationId,
                    name: 'Summer League',
                    alternate_price: 100000, // $1,000.00
                    alternate_accounting_code: 'ACC100',
                    allow_alternates: true,
                    season_id: seasonId
                  }
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'user_alternate_registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'alt-1',
                  user_id: userId,
                  discount_code_id: discountCodeId,
                  created_at: '2026-07-01T10:00:00Z',
                  users: {
                    id: userId,
                    first_name: 'Jane',
                    last_name: 'Doe',
                    email: 'jane@example.com',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded'
                  },
                  discount_codes: {
                    id: discountCodeId,
                    code: 'PRIDE75',
                    percentage: 75,
                    uses_user_allowance: false,
                    usage_limit: null,
                    category: {
                      id: 'cat-aid',
                      name: 'Financial Aid',
                      max_discount_per_user_per_season: null,
                      requires_user_allowance: false,
                      default_percentage: 50
                    }
                  }
                }
              ],
              error: null
            })
          })
        }
      }
      if (table === 'alternate_selections') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: userId,
                    first_name: 'Jane',
                    last_name: 'Doe',
                    email: 'jane@example.com',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded',
                    stripe_customer_id: 'cus_123'
                  }
                ],
                error: null
              })
            }),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: userId,
                  first_name: 'Jane',
                  last_name: 'Doe',
                  email: 'jane@example.com',
                  stripe_payment_method_id: 'pm_123',
                  setup_intent_status: 'succeeded',
                  stripe_customer_id: 'cus_123'
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'discount_categories') {
        const catData = {
          id: 'cat-aid',
          name: 'Financial Aid',
          max_discount_per_user_per_season: null,
          requires_user_allowance: false,
          default_percentage: 50
        }
        const selectObj: any = Promise.resolve({ data: [catData], error: null })
        selectObj.eq = jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: catData,
            error: null
          })
        })
        return {
          select: jest.fn().mockReturnValue(selectObj)
        }
      }
      if (table === 'user_discount_allowances') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    user_id: userId,
                    discount_category_id: 'cat-aid',
                    season_id: seasonId,
                    discount_percentage: 50,
                    max_discount_amount: 25000 // $250.00 cap
                  }
                ],
                error: null
              })
            }),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    {
                      user_id: userId,
                      discount_category_id: 'cat-aid',
                      season_id: seasonId,
                      discount_percentage: 50,
                      max_discount_amount: 25000 // $250.00 cap
                    }
                  ],
                  error: null
                })
              })
            })
          })
        }
      }
      if (table === 'discount_usage_computed') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })
            }),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: [], error: null })
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
                  id: discountCodeId,
                  code: 'PRIDE75',
                  percentage: 75,
                  uses_user_allowance: false,
                  usage_limit: null,
                  category: {
                    id: 'cat-aid',
                    name: 'Financial Aid',
                    max_discount_per_user_per_season: null,
                    requires_user_allowance: false,
                    default_percentage: 50
                  }
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: registrationId,
                  name: 'Summer League',
                  alternate_price: 100000,
                  alternate_accounting_code: 'ACC100',
                  season_id: seasonId
                },
                error: null
              })
            })
          })
        }
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }) }
    })

    // Path A: Alternates List Route GET
    const request = new NextRequest(`http://localhost/api/alternate-registrations/${gameId}/alternates`)
    const response = await GET(request, { params: Promise.resolve({ gameId }) })
    const listData = await response.json()

    expect(response.status).toBe(200)
    const listAlternate = listData.alternates[0]
    expect(listAlternate.discountCode.code).toBe('PRIDE75')
    expect(listAlternate.discountCode.percentage).toBe(75) // Fixed percentage (75%), NOT allowance percentage (50%)
    expect(listAlternate.pricing.discountAmount).toBe(25000) // 75% of $1,000 capped at $250

    // Path B: AlternatePaymentService charge calculation
    const chargeResult = await AlternatePaymentService.calculateChargeAmount(
      mockSupabase,
      registrationId,
      seasonId,
      discountCodeId,
      userId
    )

    expect(chargeResult.discountAmount).toBe(25000)

    // CROSS-PATH ASSERTION: List discount amount matches charge discount amount exactly
    expect(listAlternate.pricing.discountAmount).toBe(chargeResult.discountAmount)
  })

  it('allowance-driven code produces identical discount on both paths', async () => {
    const userId = 'user-pride'
    const gameId = 'game-1'
    const registrationId = 'reg-1'
    const seasonId = 'season-1'
    const discountCodeId = 'code-pride'

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'alternate_registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: gameId,
                  registration_id: registrationId,
                  game_description: 'Game 1',
                  game_date: '2026-08-01',
                  registrations: {
                    id: registrationId,
                    name: 'Summer League',
                    alternate_price: 100000, // $1,000.00
                    alternate_accounting_code: 'ACC100',
                    allow_alternates: true,
                    season_id: seasonId
                  }
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'user_alternate_registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'alt-1',
                  user_id: userId,
                  discount_code_id: discountCodeId,
                  created_at: '2026-07-01T10:00:00Z',
                  users: {
                    id: userId,
                    first_name: 'Alex',
                    last_name: 'Smith',
                    email: 'alex@example.com',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded'
                  },
                  discount_codes: {
                    id: discountCodeId,
                    code: 'PRIDE',
                    percentage: null,
                    uses_user_allowance: true,
                    usage_limit: null,
                    category: {
                      id: 'cat-aid',
                      name: 'Financial Aid',
                      max_discount_per_user_per_season: null,
                      requires_user_allowance: true,
                      default_percentage: 50
                    }
                  }
                }
              ],
              error: null
            })
          })
        }
      }
      if (table === 'alternate_selections') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: userId,
                    first_name: 'Alex',
                    last_name: 'Smith',
                    email: 'alex@example.com',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded',
                    stripe_customer_id: 'cus_123'
                  }
                ],
                error: null
              })
            }),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: userId,
                  first_name: 'Alex',
                  last_name: 'Smith',
                  email: 'alex@example.com',
                  stripe_payment_method_id: 'pm_123',
                  setup_intent_status: 'succeeded',
                  stripe_customer_id: 'cus_123'
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'discount_categories') {
        const catData = {
          id: 'cat-aid',
          name: 'Financial Aid',
          max_discount_per_user_per_season: null,
          requires_user_allowance: true,
          default_percentage: 50
        }
        const selectObj: any = Promise.resolve({ data: [catData], error: null })
        selectObj.eq = jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: catData,
            error: null
          })
        })
        return {
          select: jest.fn().mockReturnValue(selectObj)
        }
      }
      if (table === 'user_discount_allowances') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    user_id: userId,
                    discount_category_id: 'cat-aid',
                    season_id: seasonId,
                    discount_percentage: 50,
                    max_discount_amount: 25000 // $250.00 cap
                  }
                ],
                error: null
              })
            }),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    {
                      user_id: userId,
                      discount_category_id: 'cat-aid',
                      season_id: seasonId,
                      discount_percentage: 50,
                      max_discount_amount: 25000 // $250.00 cap
                    }
                  ],
                  error: null
                })
              })
            })
          })
        }
      }
      if (table === 'discount_usage_computed') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })
            }),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: [], error: null })
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
                  id: discountCodeId,
                  code: 'PRIDE',
                  percentage: null,
                  uses_user_allowance: true,
                  usage_limit: null,
                  category: {
                    id: 'cat-aid',
                    name: 'Financial Aid',
                    max_discount_per_user_per_season: null,
                    requires_user_allowance: true,
                    default_percentage: 50
                  }
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: registrationId,
                  name: 'Summer League',
                  alternate_price: 100000,
                  alternate_accounting_code: 'ACC100',
                  season_id: seasonId
                },
                error: null
              })
            })
          })
        }
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }) }
    })

    // Path A: Alternates List Route GET
    const request = new NextRequest(`http://localhost/api/alternate-registrations/${gameId}/alternates`)
    const response = await GET(request, { params: Promise.resolve({ gameId }) })
    const listData = await response.json()
    if (response.status !== 200) throw new Error(JSON.stringify(listData))

    expect(response.status).toBe(200)
    const listAlternate = listData.alternates[0]
    expect(listAlternate.discountCode.code).toBe('PRIDE')
    expect(listAlternate.discountCode.percentage).toBe(50) // Effective allowance percentage (50%)
    expect(listAlternate.pricing.discountAmount).toBe(25000) // 50% of $1,000 capped at $250

    // Path B: AlternatePaymentService charge calculation
    const chargeResult = await AlternatePaymentService.calculateChargeAmount(
      mockSupabase,
      registrationId,
      seasonId,
      discountCodeId,
      userId
    )

    expect(chargeResult.discountAmount).toBe(25000)

    // CROSS-PATH ASSERTION: List discount amount matches charge discount amount exactly
    expect(listAlternate.pricing.discountAmount).toBe(chargeResult.discountAmount)
  })

  it('gated category without allowance produces zero discount on both paths', async () => {
    const userId = 'user-no-allowance'
    const gameId = 'game-1'
    const registrationId = 'reg-1'
    const seasonId = 'season-1'
    const discountCodeId = 'code-pride'

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'alternate_registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: gameId,
                  registration_id: registrationId,
                  game_description: 'Game 1',
                  game_date: '2026-08-01',
                  registrations: {
                    id: registrationId,
                    name: 'Summer League',
                    alternate_price: 100000,
                    alternate_accounting_code: 'ACC100',
                    allow_alternates: true,
                    season_id: seasonId
                  }
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'user_alternate_registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'alt-1',
                  user_id: userId,
                  discount_code_id: discountCodeId,
                  created_at: '2026-07-01T10:00:00Z',
                  users: {
                    id: userId,
                    first_name: 'No',
                    last_name: 'Allowance',
                    email: 'no@example.com',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded'
                  },
                  discount_codes: {
                    id: discountCodeId,
                    code: 'PRIDE',
                    percentage: null,
                    uses_user_allowance: true,
                    usage_limit: null,
                    category: {
                      id: 'cat-aid',
                      name: 'Financial Aid',
                      max_discount_per_user_per_season: null,
                      requires_user_allowance: true,
                      default_percentage: 50
                    }
                  }
                }
              ],
              error: null
            })
          })
        }
      }
      if (table === 'alternate_selections') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: userId,
                    first_name: 'No',
                    last_name: 'Allowance',
                    email: 'no@example.com',
                    stripe_payment_method_id: 'pm_123',
                    setup_intent_status: 'succeeded',
                    stripe_customer_id: 'cus_123'
                  }
                ],
                error: null
              })
            }),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: userId,
                  first_name: 'No',
                  last_name: 'Allowance',
                  email: 'no@example.com',
                  stripe_payment_method_id: 'pm_123',
                  setup_intent_status: 'succeeded',
                  stripe_customer_id: 'cus_123'
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'discount_categories') {
        const catData = {
          id: 'cat-aid',
          name: 'Financial Aid',
          max_discount_per_user_per_season: null,
          requires_user_allowance: true,
          default_percentage: 50
        }
        const selectObj: any = Promise.resolve({ data: [catData], error: null })
        selectObj.eq = jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: catData,
            error: null
          })
        })
        return {
          select: jest.fn().mockReturnValue(selectObj)
        }
      }
      if (table === 'user_discount_allowances') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })
            }),
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
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })
            }),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: [], error: null })
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
                  id: discountCodeId,
                  code: 'PRIDE',
                  percentage: null,
                  uses_user_allowance: true,
                  usage_limit: null,
                  category: {
                    id: 'cat-aid',
                    name: 'Financial Aid',
                    max_discount_per_user_per_season: null,
                    requires_user_allowance: true,
                    default_percentage: 50
                  }
                },
                error: null
              })
            })
          })
        }
      }
      if (table === 'registrations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: registrationId,
                  name: 'Summer League',
                  alternate_price: 100000,
                  alternate_accounting_code: 'ACC100',
                  season_id: seasonId
                },
                error: null
              })
            })
          })
        }
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }) }
    })

    // Path A: Alternates List Route GET
    const request = new NextRequest(`http://localhost/api/alternate-registrations/${gameId}/alternates`)
    const response = await GET(request, { params: Promise.resolve({ gameId }) })
    const listData = await response.json()

    expect(response.status).toBe(200)
    const listAlternate = listData.alternates[0]
    expect(listAlternate.discountCode.isIneligible).toBe(true)
    expect(listAlternate.discountCode.isOverLimit).toBe(false)
    expect(listAlternate.pricing.discountAmount).toBe(0)

    // Path B: AlternatePaymentService charge calculation
    const chargeResult = await AlternatePaymentService.calculateChargeAmount(
      mockSupabase,
      registrationId,
      seasonId,
      discountCodeId,
      userId
    )

    expect(chargeResult.discountAmount).toBe(0)

    // CROSS-PATH ASSERTION: Both paths return 0 discount
    expect(listAlternate.pricing.discountAmount).toBe(chargeResult.discountAmount)
  })
})
