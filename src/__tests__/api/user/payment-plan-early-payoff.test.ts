/**
 * Tests for User Payment Plan Early Payoff API
 * Endpoint: /api/user/payment-plans/early-payoff
 */

import { POST } from '@/app/api/user/payment-plans/early-payoff/route'
import { createClient } from '@/lib/supabase/server'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'

// Mock Supabase
jest.mock('@/lib/supabase/server')

// Mock PaymentPlanService
jest.mock('@/lib/services/payment-plan-service', () => ({
  PaymentPlanService: {
    processEarlyPayoff: jest.fn()
  }
}))

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

describe('/api/user/payment-plans/early-payoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('POST - Process early payoff', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'plan-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should require planId in request body', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({})
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Plan ID is required')
    })

    it('should verify payment plan belongs to user', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' }
      })

      mockSupabase.from.mockReturnValueOnce(paymentPlansChain)

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'plan-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Payment plan not found or does not belong to you')
    })

    it('should not allow payoff of non-active payment plans', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      // Payment plan query with .eq('status', 'active') won't find a completed plan
      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.single.mockResolvedValue({
        data: null,
        error: { message: 'No rows found', code: 'PGRST116' }
      })

      mockSupabase.from.mockReturnValueOnce(paymentPlansChain)

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'plan-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Payment plan not found or does not belong to you')
    })

    it('should successfully process early payoff', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.single.mockResolvedValue({
        data: {
          id: 'plan-id',
          user_id: 'user-id',
          status: 'active',
          total_amount: 10000,
          paid_amount: 5000
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(paymentPlansChain)

      ;(PaymentPlanService.processEarlyPayoff as jest.Mock).mockResolvedValueOnce({
        success: true
      })

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'plan-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Payment plan paid in full successfully'
      })
      expect(PaymentPlanService.processEarlyPayoff).toHaveBeenCalledWith('plan-id')
    })

    it('should handle payment processing failures', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.single.mockResolvedValue({
        data: {
          id: 'plan-id',
          user_id: 'user-id',
          status: 'active'
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(paymentPlansChain)

      ;(PaymentPlanService.processEarlyPayoff as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Insufficient funds'
      })

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'plan-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Insufficient funds')
    })

    it('should handle unexpected errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      const paymentPlansChain = createMockQueryChain()
      paymentPlansChain.single.mockResolvedValue({
        data: {
          id: 'plan-id',
          user_id: 'user-id',
          status: 'active'
        },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(paymentPlansChain)

      ;(PaymentPlanService.processEarlyPayoff as jest.Mock).mockRejectedValueOnce(
        new Error('Unexpected error')
      )

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'plan-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('An unexpected error occurred')
    })
  })
})
