/**
 * Tests for Admin Payment Plan Eligibility API
 * Endpoint: /api/admin/users/[id]/payment-plan-eligibility
 */

import { GET, PUT } from '@/app/api/admin/users/[id]/payment-plan-eligibility/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Mock Supabase
jest.mock('@/lib/supabase/server')

// Mock logger
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logAdminAction: jest.fn()
  }
}))

const createMockQueryChain = () => ({
  select: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn()
})

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn()
}

const mockAdminSupabase = {
  from: jest.fn()
}

describe('/api/admin/users/[id]/payment-plan-eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockReturnValue(mockAdminSupabase)
  })

  describe('GET - Fetch payment plan eligibility', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility')
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

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility')
      const response = await GET(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('should return payment plan eligibility status', async () => {
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

      // Second call: get target user eligibility
      const userChain = createMockQueryChain()
      userChain.single.mockResolvedValue({
        data: { payment_plan_enabled: true },
        error: null
      })

      mockSupabase.from
        .mockReturnValueOnce(adminCheckChain)
        .mockReturnValueOnce(userChain)

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plan-eligibility')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        userId: 'target-user-id',
        paymentPlanEnabled: true
      })
    })

    it('should handle user not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      const userChain = createMockQueryChain()
      userChain.single.mockResolvedValue({
        data: null,
        error: { message: 'User not found' }
      })

      mockSupabase.from
        .mockReturnValueOnce(adminCheckChain)
        .mockReturnValueOnce(userChain)

      const request = new Request('http://localhost:3000/api/admin/users/invalid-id/payment-plan-eligibility')
      const response = await GET(request, { params: { id: 'invalid-id' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('User not found')
    })
  })

  describe('PUT - Update payment plan eligibility', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true })
      })
      const response = await PUT(request, { params: { id: 'test-id' } })
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

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true })
      })
      const response = await PUT(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('should validate enabled field is boolean', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(adminCheckChain)

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: 'yes' })
      })
      const response = await PUT(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('enabled must be a boolean')
    })

    it('should update payment plan eligibility', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(adminCheckChain)

      // Mock the admin client update
      const updateChain = createMockQueryChain()
      updateChain.single.mockResolvedValue({
        data: {
          id: 'target-user-id',
          email: 'user@example.com',
          first_name: 'Test',
          last_name: 'User',
          payment_plan_enabled: true
        },
        error: null
      })

      mockAdminSupabase.from.mockReturnValueOnce(updateChain)

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true })
      })
      const response = await PUT(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        user: {
          id: 'target-user-id',
          email: 'user@example.com',
          first_name: 'Test',
          last_name: 'User',
          payment_plan_enabled: true
        }
      })
    })

    it('should handle update errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      const adminCheckChain = createMockQueryChain()
      adminCheckChain.single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

      mockSupabase.from.mockReturnValueOnce(adminCheckChain)

      const updateChain = createMockQueryChain()
      updateChain.single.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' }
      })

      mockAdminSupabase.from.mockReturnValueOnce(updateChain)

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false })
      })
      const response = await PUT(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update eligibility')
    })
  })
})
