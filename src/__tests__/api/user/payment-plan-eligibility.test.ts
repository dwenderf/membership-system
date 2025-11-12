/**
 * Tests for User Payment Plan Eligibility API
 * Endpoint: /api/user/payment-plan-eligibility
 */

import { GET } from '@/app/api/user/payment-plan-eligibility/route'
import { createClient } from '@/lib/supabase/server'

// Mock Supabase
jest.mock('@/lib/supabase/server')

const createMockQueryChain = () => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn()
})

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

describe('/api/user/payment-plan-eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('GET - Check payment plan eligibility', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return eligible when user has eligibility flag and saved payment method', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      // Single call to from('users'): get both eligibility flag and payment method
      const usersChain = createMockQueryChain()
      usersChain.single.mockResolvedValue({
        data: {
          payment_plan_enabled: true,
          stripe_payment_method_id: 'pm_123456789'
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(usersChain)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        eligible: true,
        paymentPlanEnabled: true,
        hasSavedPaymentMethod: true
      })
    })

    it('should return not eligible when user has no eligibility flag', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const usersChain = createMockQueryChain()
      usersChain.single.mockResolvedValue({
        data: {
          payment_plan_enabled: false,
          stripe_payment_method_id: 'pm_123456789'
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(usersChain)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        eligible: false,
        paymentPlanEnabled: false,
        hasSavedPaymentMethod: true
      })
    })

    it('should return not eligible when user has no saved payment method', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const usersChain = createMockQueryChain()
      usersChain.single.mockResolvedValue({
        data: {
          payment_plan_enabled: true,
          stripe_payment_method_id: null
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(usersChain)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        eligible: false,
        paymentPlanEnabled: true,
        hasSavedPaymentMethod: false
      })
    })

    it('should return not eligible when both conditions are false', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const usersChain = createMockQueryChain()
      usersChain.single.mockResolvedValue({
        data: {
          payment_plan_enabled: false,
          stripe_payment_method_id: null
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(usersChain)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        eligible: false,
        paymentPlanEnabled: false,
        hasSavedPaymentMethod: false
      })
    })

    it('should handle database errors gracefully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const usersChain = createMockQueryChain()
      usersChain.single.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      })

      mockSupabase.from.mockReturnValueOnce(usersChain)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch user data')
    })
  })
})
