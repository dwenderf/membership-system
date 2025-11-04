/**
 * Tests for Admin Payment Plan Eligibility API
 * Endpoint: /api/admin/users/[id]/payment-plan-eligibility
 */

import { GET, PUT } from '@/app/api/admin/users/[id]/payment-plan-eligibility/route'
import { createClient } from '@/lib/supabase/server'

// Mock Supabase
jest.mock('@/lib/supabase/server')

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn()
  }))
}

describe('/api/admin/users/[id]/payment-plan-eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
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

      mockSupabase.from().single.mockResolvedValue({
        data: { is_admin: false },
        error: null
      })

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
      mockSupabase.from().single
        .mockResolvedValueOnce({
          data: { is_admin: true },
          error: null
        })
        // Second call: get target user eligibility
        .mockResolvedValueOnce({
          data: { payment_plan_enabled: true },
          error: null
        })

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plan-eligibility')
      const response = await GET(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ enabled: true })
    })

    it('should handle user not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      mockSupabase.from().single
        .mockResolvedValueOnce({
          data: { is_admin: true },
          error: null
        })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'User not found' }
        })

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

      mockSupabase.from().single.mockResolvedValue({
        data: { is_admin: false },
        error: null
      })

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

      mockSupabase.from().single.mockResolvedValue({
        data: { is_admin: true },
        error: null
      })

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

      mockSupabase.from().single
        .mockResolvedValueOnce({
          data: { is_admin: true },
          error: null
        })
        .mockResolvedValueOnce({
          data: { id: 'target-user-id', payment_plan_enabled: true },
          error: null
        })

      const request = new Request('http://localhost:3000/api/admin/users/target-user-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true })
      })
      const response = await PUT(request, { params: { id: 'target-user-id' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        enabled: true
      })
    })

    it('should handle update errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-id' } },
        error: null
      })

      mockSupabase.from().single
        .mockResolvedValueOnce({
          data: { is_admin: true },
          error: null
        })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'Update failed' }
        })

      const request = new Request('http://localhost:3000/api/admin/users/test-id/payment-plan-eligibility', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false })
      })
      const response = await PUT(request, { params: { id: 'test-id' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update payment plan eligibility')
    })
  })
})
