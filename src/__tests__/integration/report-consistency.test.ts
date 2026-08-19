/**
 * Non-tautological Integration Test: Cross-report consistency between Discount Usage
 * and Discount Eligibility reports.
 *
 * Verifies that GET /api/admin/reports/discount-usage and
 * GET /api/admin/reports/discount-eligibility run real per-user limit resolution
 * end-to-end and compute identical remaining balances for the same user and season.
 *
 * Underlying DB state sets category default cap = $750 (75000 cents) and allowance cap = $250 (25000 cents).
 * If either route reads raw category limits directly instead of using the resolver,
 * it will return $650 remaining (75000 - 10000) instead of $150 remaining (25000 - 10000), failing the test.
 */

import { GET as getUsageReport } from '@/app/api/admin/reports/discount-usage/route'
import { GET as getEligibilityReport } from '@/app/api/admin/reports/discount-eligibility/route'
import { NextRequest } from 'next/server'

// Mock Supabase Server Clients - Real discount-limit-service runs against this mocked client
const mockSupabase: any = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
  createAdminClient: jest.fn(() => mockSupabase)
}))

describe('Report Consistency Integration (End-to-End Resolution)', () => {
  const userId = 'user-fa-1'
  const seasonId = 'season-2026'
  const categoryId = 'cat-fa'

  beforeEach(() => {
    jest.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-id' } }, error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
            })
          })
        }
      }

      if (table === 'seasons') {
        return {
          select: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [
                { id: seasonId, name: 'Spring 2026', start_date: '2026-03-01', end_date: '2026-12-31' }
              ],
              error: null
            })
          })
        }
      }

      if (table === 'discount_categories') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: categoryId,
                  name: 'Financial Aid',
                  requires_user_allowance: true,
                  max_discount_per_user_per_season: 75000, // $750 category cap (DIFFERENT from allowance cap!)
                  default_percentage: null
                },
                error: null
              }),
              in: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: categoryId,
                    name: 'Financial Aid',
                    requires_user_allowance: true,
                    max_discount_per_user_per_season: 75000,
                    default_percentage: null
                  }
                ],
                error: null
              })
            }),
            in: jest.fn().mockResolvedValue({
              data: [
                {
                  id: categoryId,
                  name: 'Financial Aid',
                  requires_user_allowance: true,
                  max_discount_per_user_per_season: 75000,
                  default_percentage: null
                }
              ],
              error: null
            }),
            data: [
              {
                id: categoryId,
                name: 'Financial Aid',
                requires_user_allowance: true,
                max_discount_per_user_per_season: 75000,
                default_percentage: null
              }
            ],
            error: null
          })
        }
      }

      if (table === 'user_discount_allowances') {
        const allowanceRow = {
          id: 'allowance-1',
          user_id: userId,
          discount_category_id: categoryId,
          season_id: seasonId,
          discount_percentage: 50,
          max_discount_amount: 25000, // $250 allowance cap (overrides $750 category default cap!)
          notes: 'FA Aid 50%',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          user: { id: userId, first_name: 'Charlie', last_name: 'Brown', email: 'charlie@example.com', member_id: 'M200' },
          category: { id: categoryId, name: 'Financial Aid', requires_user_allowance: true }
        }

        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockImplementation(() => ({
              eq: jest.fn().mockImplementation(() => ({
                eq: jest.fn().mockResolvedValue({
                  data: [allowanceRow],
                  error: null
                }),
                data: [allowanceRow],
                error: null
              })),
              in: jest.fn().mockResolvedValue({
                data: [allowanceRow],
                error: null
              }),
              data: [allowanceRow],
              error: null
            })),
            in: jest.fn().mockImplementation(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [allowanceRow],
                error: null
              }),
              in: jest.fn().mockResolvedValue({
                data: [allowanceRow],
                error: null
              }),
              data: [allowanceRow],
              error: null
            }))
          })
        }
      }

      if (table === 'discount_usage_computed') {
        const usageRow = {
          id: 'usage-1',
          user_id: userId,
          user_first_name: 'Charlie',
          user_last_name: 'Brown',
          user_email: 'charlie@example.com',
          user_member_id: 'M200',
          amount_saved: 10000, // $100 used
          used_at: '2026-03-02T00:00:00Z',
          season_id: seasonId,
          season_name: 'Spring 2026',
          season_start_date: '2026-03-01',
          season_end_date: '2026-12-31',
          discount_category_id: categoryId,
          discount_category_name: 'Financial Aid',
          discount_category_max_per_season: 75000, // $750 raw category default cap in view
          discount_code_id: 'code-1',
          discount_code: 'FA50',
          registration_name: 'Spring League'
        }

        return {
          select: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [usageRow],
              error: null
            }),
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ user_id: userId, discount_category_id: categoryId, amount_saved: 10000 }],
                error: null
              })
            })
          })
        }
      }

      return {}
    })
  })

  it('Discount Usage and Discount Eligibility reports agree on remaining balance ($150) driven by allowance cap ($250), not category cap ($750)', async () => {
    // 1. Call Usage Report GET
    const reqUsage = new NextRequest('http://localhost/api/admin/reports/discount-usage')
    const resUsage = await getUsageReport(reqUsage)
    expect(resUsage.status).toBe(200)
    const usageData = await resUsage.json()

    // 2. Call Eligibility Report GET
    const reqEligibility = new NextRequest(`http://localhost/api/admin/reports/discount-eligibility?seasonId=${seasonId}`)
    const resEligibility = await getEligibilityReport(reqEligibility)
    expect(resEligibility.status).toBe(200)
    const eligibilityData = await resEligibility.json()

    // Extract user record from Usage Report
    const seasonUsage = usageData.seasons.find((s: any) => s.seasonId === seasonId)
    const catUsage = seasonUsage.categories.find((c: any) => c.categoryId === categoryId)
    const userUsage = catUsage.users.find((u: any) => u.userId === userId)

    // Extract user record from Eligibility Report
    const userEligibility = eligibilityData.eligibility.find((e: any) => e.userId === userId && e.categoryId === categoryId)

    // Verify both reports read the $100 total used
    expect(userUsage.totalAmount).toBe(10000)
    expect(userEligibility.totalUsed).toBe(10000)

    // VERIFY NON-TAUTOLOGICAL RESOLUTION:
    // Allowance cap = $250 (25000 cents). Used = $100 (10000 cents).
    // Remaining MUST be $150 (15000 cents) on BOTH reports.
    // If either report read the category default cap ($750), remaining would be $650 (65000 cents) and fail here.
    expect(userUsage.remaining).toBe(15000)
    expect(userEligibility.remaining).toBe(15000)
    expect(userUsage.remaining).toBe(userEligibility.remaining)
  })
})
