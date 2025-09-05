// Test file for admin alternate registration configuration API
import { PUT } from '@/app/api/admin/registrations/[id]/alternates/route'
import { NextRequest } from 'next/server'

// Jest globals are available, but we need to declare them for TypeScript
declare const jest: any
declare const describe: any
declare const it: any
declare const expect: any
declare const beforeEach: any

// Mock dependencies
jest.mock('@/lib/supabase/server')
jest.mock('@/lib/logging/logger')

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn()
      }))
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null }))
    })),
    delete: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null }))
    }))
  }))
}

const mockLogger = {
  logSystem: jest.fn()
}

// Mock the modules
require('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))
require('@/lib/logging/logger').logger = mockLogger

describe('/api/admin/registrations/[id]/alternates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('PUT - Update alternate configuration', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ allow_alternates: true, alternate_price: 50, alternate_accounting_code: 'ALT001' })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should require admin privileges', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'user-123' } } 
      })

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { is_admin: false },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ allow_alternates: true, alternate_price: 50, alternate_accounting_code: 'ALT001' })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('should validate required fields when enabling alternates', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'admin-123' } } 
      })

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { is_admin: true },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ 
          allow_alternates: true, 
          alternate_price: 0, // Invalid price
          alternate_accounting_code: 'ALT001' 
        })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Alternate price is required and must be greater than 0')
    })

    it('should validate accounting code when enabling alternates', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'admin-123' } } 
      })

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { is_admin: true },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ 
          allow_alternates: true, 
          alternate_price: 50, 
          alternate_accounting_code: '' // Invalid code
        })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Alternate accounting code is required')
    })

    it('should successfully enable alternates with valid configuration', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'admin-123' } } 
      })

      // Mock admin check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { is_admin: true },
              error: null
            }))
          }))
        }))
      })

      // Mock registration check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'reg-123', name: 'Test Registration' },
              error: null
            }))
          }))
        }))
      })

      // Mock update
      mockSupabase.from.mockReturnValueOnce({
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ 
          allow_alternates: true, 
          alternate_price: 50, 
          alternate_accounting_code: 'ALT001' 
        })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.configuration.allow_alternates).toBe(true)
      expect(data.configuration.alternate_price).toBe(50)
      expect(data.configuration.alternate_accounting_code).toBe('ALT001')
    })

    it('should successfully disable alternates and clean up registrations', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'admin-123' } } 
      })

      // Mock admin check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { is_admin: true },
              error: null
            }))
          }))
        }))
      })

      // Mock registration check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'reg-123', name: 'Test Registration' },
              error: null
            }))
          }))
        }))
      })

      // Mock update
      mockSupabase.from.mockReturnValueOnce({
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      })

      // Mock cleanup
      mockSupabase.from.mockReturnValueOnce({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null }))
        }))
      })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ 
          allow_alternates: false, 
          alternate_price: null, 
          alternate_accounting_code: null 
        })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.configuration.allow_alternates).toBe(false)
      expect(data.configuration.alternate_price).toBe(null)
      expect(data.configuration.alternate_accounting_code).toBe(null)
    })

    it('should handle registration not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'admin-123' } } 
      })

      // Mock admin check
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { is_admin: true },
              error: null
            }))
          }))
        }))
      })

      // Mock registration check - not found
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { message: 'Not found' }
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/admin/registrations/reg-123/alternates', {
        method: 'PUT',
        body: JSON.stringify({ 
          allow_alternates: true, 
          alternate_price: 50, 
          alternate_accounting_code: 'ALT001' 
        })
      })

      const response = await PUT(request, { params: Promise.resolve({ id: 'reg-123' }) })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Registration not found')
    })
  })
})