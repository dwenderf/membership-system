/**
 * Tests for Admin User Payment Plans API
 * Endpoint: /api/admin/users/[id]/payment-plans
 */

import { GET } from '@/app/api/admin/users/[id]/payment-plans/route'
import { createClient } from '@/lib/supabase/server'

// Mock Supabase
jest.mock('@/lib/supabase/server')

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn()
  }))
}

describe('/api/admin/users/[id]/payment-plans', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('GET - Fetch user payment plans', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plans')
      const response = await GET(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should require admin privileges', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      mockSupabase.from().single.mockResolvedValue({
        data: { is_admin: false },
        error: null
      })

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plans')
      const response = await GET(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('should return user payment plans with related data', async () => {
      const mockPaymentPlans = [
        {
          id: 'plan-1',
          total_amount: 10000,
          paid_amount: 5000,
          installment_amount: 2500,
          installments_count: 4,
          installments_paid: 2,
          next_payment_date: '2025-12-01',
          status: 'active',
          created_at: '2025-11-01T00:00:00Z',
          user_registrations: {
            registration_categories: {
              custom_name: null,
              categories: {
                name: 'Player'
              }
            },
            registrations: {
              name: 'Fall League',
              season: {
                name: 'Fall 2025'
              }
            }
          }
        }
      ]

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      // First call: check admin status
      mockSupabase.from().single.mockResolvedValueOnce({
        data: { is_admin: true },
        error: null
      })

      // Second call: get payment plans (returns array, not single)
      const mockFrom = mockSupabase.from as jest.Mock
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: mockPaymentPlans,
          error: null
        })
      })

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plans')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.paymentPlans).toHaveLength(1)
      expect(data.paymentPlans[0].id).toBe('plan-1')
      expect(data.paymentPlans[0].status).toBe('active')
    })

    it('should return empty array when user has no payment plans', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      mockSupabase.from().single.mockResolvedValueOnce({
        data: { is_admin: true },
        error: null
      })

      const mockFrom = mockSupabase.from as jest.Mock
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [],
          error: null
        })
      })

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plans')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.paymentPlans).toEqual([])
    })

    it('should handle database errors gracefully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      mockSupabase.from().single.mockResolvedValueOnce({
        data: { is_admin: true },
        error: null
      })

      const mockFrom = mockSupabase.from as jest.Mock
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' }
        })
      })

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plans')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch payment plans')
    })
  })
})
