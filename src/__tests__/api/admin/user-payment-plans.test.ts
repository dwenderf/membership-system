/**
 * Tests for Admin User Payment Plans API
 * Endpoint: /api/admin/users/[id]/payment-plans
 */

import { GET } from '@/app/api/admin/users/[id]/payment-plans/route'
import { createClient } from '@/lib/supabase/server'

// Mock Supabase
jest.mock('@/lib/supabase/server')

const createMockQueryChain = () => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: jest.fn()
})

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
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

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: false },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(adminCheckChain)

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plans')
      const response = await GET(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('should return user payment plans with related data', async () => {
      // Mock data from payment_plan_summary view with nested invoice data
      const mockPaymentPlans = [
        {
          invoice_id: 'invoice-1',
          contact_id: 'target-user-id',
          total_installments: 4,
          paid_amount: 5000,
          total_amount: 10000,
          installments_paid: 2,
          next_payment_date: '2025-12-01',
          final_payment_date: '2026-02-01',
          status: 'active',
          invoice: {
            payment_id: 'payment-1',
            user_registrations: [
              {
                registration: {
                  name: 'Fall League',
                  season: {
                    name: 'Fall 2025'
                  }
                }
              }
            ]
          }
        }
      ]

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      // First call: check admin status
      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      // Second call: get payment plans from payment_plan_summary view
      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.eq = jest.fn().mockResolvedValue({
        data: mockPaymentPlans,
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(adminCheckChain)
        .mockReturnValueOnce(paymentPlansChain)

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plans')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.userId).toBe('target-user-id')
      expect(data.plans).toHaveLength(1)
      expect(data.plans[0].id).toBe('invoice-1')
      expect(data.plans[0].status).toBe('active')
      expect(data.plans[0].registrationName).toBe('Fall League')
    })

    it('should return empty array when user has no payment plans', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.eq = jest.fn().mockResolvedValue({
        data: [],
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(adminCheckChain)
        .mockReturnValueOnce(paymentPlansChain)

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plans')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.userId).toBe('target-user-id')
      expect(data.plans).toEqual([])
    })

    it('should handle database errors gracefully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.eq = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      })

      mockSupabase.from
        .mockReturnValueOnce(adminCheckChain)
        .mockReturnValueOnce(paymentPlansChain)

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plans')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch payment plans')
    })
  })
})
