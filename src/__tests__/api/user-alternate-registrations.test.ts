// Test file for user alternate registrations API endpoints
// Currently disabled - Jest configuration needed

/*
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { POST, GET } from '@/app/api/user-alternate-registrations/route'
import { NextRequest } from 'next/server'

// Mock dependencies
jest.mock('@/lib/supabase/server')
jest.mock('@/lib/services/setup-intent-service')
jest.mock('@/lib/logging/logger')

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(),
        order: jest.fn(() => ({
          single: jest.fn()
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn()
        }))
      }))
    }))
  }))
}

const mockSetupIntentService = {
  createSetupIntent: jest.fn()
}

const mockLogger = {
  logPaymentProcessing: jest.fn(),
  logSystem: jest.fn()
}

// Mock the modules
require('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))
require('@/lib/services/setup-intent-service').setupIntentService = mockSetupIntentService
require('@/lib/logging/logger').logger = mockLogger

describe('/api/user-alternate-registrations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST - Register as alternate', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({ registrationId: 'reg-123' })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should require registrationId', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'user-123' } } 
      })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({})
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Registration ID is required')
    })

    it('should prevent registration when alternates are not allowed', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'user-123' } } 
      })

      // Mock user lookup
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'user-123', first_name: 'John', last_name: 'Doe' },
              error: null
            }))
          }))
        }))
      })

      // Mock registration lookup - alternates not allowed
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'reg-123', name: 'Test Registration', allow_alternates: false },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({ registrationId: 'reg-123' })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('This registration does not allow alternates')
    })

    it('should prevent duplicate alternate registration', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'user-123' } } 
      })

      // Mock user lookup
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'user-123', first_name: 'John', last_name: 'Doe' },
              error: null
            }))
          }))
        }))
      })

      // Mock registration lookup - alternates allowed
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { 
                id: 'reg-123', 
                name: 'Test Registration', 
                allow_alternates: true,
                alternate_price: 5000,
                alternate_accounting_code: 'ALT001'
              },
              error: null
            }))
          }))
        }))
      })

      // Mock existing regular registration check - none found
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: null,
                  error: null
                }))
              }))
            }))
          }))
        }))
      })

      // Mock existing alternate registration check - found existing
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: { id: 'existing-alt-123' },
                error: null
              }))
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({ registrationId: 'reg-123' })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('You are already registered as an alternate for this registration')
    })

    it('should successfully register as alternate with valid payment method', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'user-123' } } 
      })

      // Mock user lookup with valid payment method
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { 
                id: 'user-123', 
                first_name: 'John', 
                last_name: 'Doe',
                stripe_payment_method_id: 'pm_123',
                setup_intent_status: 'succeeded'
              },
              error: null
            }))
          }))
        }))
      })

      // Mock registration lookup
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { 
                id: 'reg-123', 
                name: 'Test Registration', 
                allow_alternates: true,
                alternate_price: 5000,
                alternate_accounting_code: 'ALT001'
              },
              error: null
            }))
          }))
        }))
      })

      // Mock existing registration checks - none found
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: null, error: null }))
              }))
            }))
          }))
        }))
      })

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: null }))
            }))
          }))
        }))
      })

      // Mock successful insert
      mockSupabase.from.mockReturnValueOnce({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { 
                id: 'alt-reg-123',
                user_id: 'user-123',
                registration_id: 'reg-123',
                registered_at: new Date().toISOString()
              },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({ registrationId: 'reg-123' })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.alternateRegistration.registrationId).toBe('reg-123')
      expect(data.setupIntent).toBeUndefined() // No setup intent needed
    })
  })

  describe('GET - Get alternate registrations', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return user alternate registrations', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ 
        data: { user: { id: 'user-123' } } 
      })

      // Mock alternate registrations query
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => Promise.resolve({
              data: [
                {
                  id: 'alt-reg-123',
                  registered_at: new Date().toISOString(),
                  registrations: {
                    id: 'reg-123',
                    name: 'Test Registration',
                    alternate_price: 5000
                  }
                }
              ],
              error: null
            }))
          }))
        }))
      })

      // Mock user payment method status
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { 
                stripe_payment_method_id: 'pm_123',
                setup_intent_status: 'succeeded'
              },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/user-alternate-registrations')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.alternateRegistrations).toHaveLength(1)
      expect(data.paymentMethodStatus.hasValidPaymentMethod).toBe(true)
    })
  })
})
*/