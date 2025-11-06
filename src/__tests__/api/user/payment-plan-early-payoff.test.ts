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
  single: jest.fn(),
  limit: jest.fn().mockReturnThis()
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

      // Mock xero_invoices query - invoice not found
      const invoiceChain = createMockQueryChain()
      invoiceChain.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' }
      })

      mockSupabase.from.mockReturnValueOnce(invoiceChain)

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'invoice-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Payment plan not found or does not belong to you')
    })

    it('should not allow payoff of payment plans with no planned payments', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      // Mock xero_invoices query - invoice exists
      const invoiceChain = createMockQueryChain()
      invoiceChain.single.mockResolvedValue({
        data: {
          id: 'invoice-id',
          contact_id: 'user-id',
          is_payment_plan: true
        },
        error: null
      })

      // Mock xero_payments query - no planned payments (all completed)
      const paymentsChain = createMockQueryChain()
      paymentsChain.limit.mockResolvedValue({
        data: [],
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(invoiceChain)
        .mockReturnValueOnce(paymentsChain)

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'invoice-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Payment plan is already completed')
    })

    it('should successfully process early payoff', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      // Mock xero_invoices query - invoice exists
      const invoiceChain = createMockQueryChain()
      invoiceChain.single.mockResolvedValue({
        data: {
          id: 'invoice-id',
          contact_id: 'user-id',
          is_payment_plan: true
        },
        error: null
      })

      // Mock xero_payments query - has planned payments
      const paymentsChain = createMockQueryChain()
      paymentsChain.limit.mockResolvedValue({
        data: [{ id: 'payment-1' }],
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(invoiceChain)
        .mockReturnValueOnce(paymentsChain)

      ;(PaymentPlanService.processEarlyPayoff as jest.Mock).mockResolvedValueOnce({
        success: true
      })

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'invoice-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Payment plan paid in full successfully'
      })
      expect(PaymentPlanService.processEarlyPayoff).toHaveBeenCalledWith('invoice-id')
    })

    it('should handle payment processing failures', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
        error: null
      })

      // Mock xero_invoices query
      const invoiceChain = createMockQueryChain()
      invoiceChain.single.mockResolvedValue({
        data: {
          id: 'invoice-id',
          contact_id: 'user-id',
          is_payment_plan: true
        },
        error: null
      })

      // Mock xero_payments query
      const paymentsChain = createMockQueryChain()
      paymentsChain.limit.mockResolvedValue({
        data: [{ id: 'payment-1' }],
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(invoiceChain)
        .mockReturnValueOnce(paymentsChain)

      ;(PaymentPlanService.processEarlyPayoff as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Insufficient funds'
      })

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'invoice-id' })
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

      // Mock xero_invoices query
      const invoiceChain = createMockQueryChain()
      invoiceChain.single.mockResolvedValue({
        data: {
          id: 'invoice-id',
          contact_id: 'user-id',
          is_payment_plan: true
        },
        error: null
      })

      // Mock xero_payments query
      const paymentsChain = createMockQueryChain()
      paymentsChain.limit.mockResolvedValue({
        data: [{ id: 'payment-1' }],
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(invoiceChain)
        .mockReturnValueOnce(paymentsChain)

      ;(PaymentPlanService.processEarlyPayoff as jest.Mock).mockRejectedValueOnce(
        new Error('Unexpected error')
      )

      const request = new Request('http://localhost:3000/api/user/payment-plans/early-payoff', {
        method: 'POST',
        body: JSON.stringify({ planId: 'invoice-id' })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('An unexpected error occurred')
    })
  })
})
