// Test file for alternate registrations (games) API endpoints
import { GET, POST } from '@/app/api/alternate-registrations/route'
import { NextRequest } from 'next/server'

// Mock dependencies
jest.mock('@/lib/supabase/server')
jest.mock('@/lib/logging/logger')
jest.mock('@/lib/utils/alternates-access')

const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
    order: jest.fn().mockReturnThis()
  }))
}

const mockLogger = {
  logSystem: jest.fn()
}

// Mock the imports
require('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))
require('@/lib/logging/logger').logger = mockLogger

const { canAccessRegistrationAlternates } = require('@/lib/utils/alternates-access')

describe('/api/alternate-registrations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET - Get games for registration', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest('http://localhost/api/alternate-registrations?registration_id=reg-123')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should require registration_id parameter', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })

      const request = new NextRequest('http://localhost/api/alternate-registrations')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Registration ID is required')
    })

    it('should require admin or captain access', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })

      // Mock access check - user is neither admin nor captain
      canAccessRegistrationAlternates.mockResolvedValue(false)

      const request = new NextRequest('http://localhost/api/alternate-registrations?registrationId=reg-123')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('You do not have access to manage alternates for this registration')
    })

    it('should return games for valid admin request', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123' } }
      })

      // Mock access check - user has access (admin or captain)
      canAccessRegistrationAlternates.mockResolvedValue(true)

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
                alternate_accounting_code: 'ALT001',
                seasons: { name: 'Test Season' }
              },
              error: null
            }))
          }))
        }))
      })

      // Mock games lookup
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => Promise.resolve({
              data: [
                {
                  id: 'game-123',
                  registration_id: 'reg-123',
                  game_description: 'Test Game',
                  game_date: '2024-01-15T19:00:00Z',
                  created_at: '2024-01-01T10:00:00Z',
                  created_by: 'admin-123',
                  alternate_selections: []
                }
              ],
              error: null
            }))
          }))
        }))
      })

      // Mock user_alternate_registrations count lookup
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({
            data: [],
            error: null
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/alternate-registrations?registrationId=reg-123')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.games).toHaveLength(1)
      expect(data.games[0].game_description).toBe('Test Game')
      expect(data.registration.name).toBe('Test Registration')
    })
  })

  describe('POST - Create new game', () => {
    it('should require authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest('http://localhost/api/alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationId: 'reg-123',
          gameDescription: 'Test Game'
        })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should validate required fields', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123' } }
      })

      const request = new NextRequest('http://localhost/api/alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationId: 'reg-123'
          // Missing gameDescription
        })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Game description is required')
    })

    it('should require admin or captain access', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })

      // Mock access check - user is neither admin nor captain
      canAccessRegistrationAlternates.mockResolvedValue(false)

      const request = new NextRequest('http://localhost/api/alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationId: 'reg-123',
          gameDescription: 'Test Game'
        })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('You do not have access to manage alternates for this registration')
    })

    it('should successfully create game with valid data', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123' } }
      })

      // Mock access check - user has access (admin or captain)
      canAccessRegistrationAlternates.mockResolvedValue(true)

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

      // Mock game creation
      mockSupabase.from.mockReturnValueOnce({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: 'game-123',
                registration_id: 'reg-123',
                game_description: 'Test Game',
                game_date: null,
                created_at: '2024-01-01T10:00:00Z',
                created_by: 'admin-123'
              },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationId: 'reg-123',
          gameDescription: 'Test Game'
        })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.game.game_description).toBe('Test Game')
      expect(data.message).toBe('Game created successfully')
    })

    it('should handle registration that does not allow alternates', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123' } }
      })

      // Mock access check - user has access (admin or captain)
      canAccessRegistrationAlternates.mockResolvedValue(true)

      // Mock registration lookup (alternates not allowed)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: 'reg-123',
                name: 'Test Registration',
                allow_alternates: false,
                alternate_price: null,
                alternate_accounting_code: null
              },
              error: null
            }))
          }))
        }))
      })

      const request = new NextRequest('http://localhost/api/alternate-registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationId: 'reg-123',
          gameDescription: 'Test Game'
        })
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('This registration does not allow alternates')
    })
  })

  describe('Security - Captain Access Scoping', () => {
    describe('GET - Captain can only view their assigned teams', () => {
      it('should allow captain to view games for their assigned registration', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'captain-123' } }
        })

        // Mock access check - captain has access to this registration
        canAccessRegistrationAlternates.mockResolvedValue(true)

        // Mock registration lookup
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'reg-123',
                  name: 'Team A',
                  allow_alternates: true,
                  alternate_price: 5000,
                  alternate_accounting_code: 'ALT001',
                  seasons: { name: 'Season 2024' }
                },
                error: null
              }))
            }))
          }))
        })

        // Mock games lookup
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => Promise.resolve({
                data: [{ id: 'game-123', game_description: 'Game 1' }],
                error: null
              }))
            }))
          }))
        })

        // Mock user_alternate_registrations count
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({
              data: [],
              error: null
            }))
          }))
        })

        const request = new NextRequest('http://localhost/api/alternate-registrations?registrationId=reg-123')
        const response = await GET(request)

        expect(response.status).toBe(200)
        expect(canAccessRegistrationAlternates).toHaveBeenCalledWith('reg-123')
      })

      it('should block captain from viewing games for unassigned registration', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'captain-123' } }
        })

        // Mock access check - captain does NOT have access to this registration
        canAccessRegistrationAlternates.mockResolvedValue(false)

        const request = new NextRequest('http://localhost/api/alternate-registrations?registrationId=reg-456')
        const response = await GET(request)
        const data = await response.json()

        expect(response.status).toBe(403)
        expect(data.error).toBe('You do not have access to manage alternates for this registration')
        expect(canAccessRegistrationAlternates).toHaveBeenCalledWith('reg-456')
      })
    })

    describe('POST - Captain can only create games for their assigned teams', () => {
      it('should allow captain to create game for their assigned registration', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'captain-123' } }
        })

        // Mock access check - captain has access
        canAccessRegistrationAlternates.mockResolvedValue(true)

        // Mock registration lookup
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'reg-123',
                  name: 'Team A',
                  allow_alternates: true,
                  alternate_price: 5000,
                  alternate_accounting_code: 'ALT001'
                },
                error: null
              }))
            }))
          }))
        })

        // Mock game creation
        mockSupabase.from.mockReturnValueOnce({
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'game-123',
                  registration_id: 'reg-123',
                  game_description: 'Test Game',
                  created_by: 'captain-123'
                },
                error: null
              }))
            }))
          }))
        })

        const request = new NextRequest('http://localhost/api/alternate-registrations', {
          method: 'POST',
          body: JSON.stringify({
            registrationId: 'reg-123',
            gameDescription: 'Test Game'
          })
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(canAccessRegistrationAlternates).toHaveBeenCalledWith('reg-123')
      })

      it('should block captain from creating game for unassigned registration', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'captain-123' } }
        })

        // Mock access check - captain does NOT have access
        canAccessRegistrationAlternates.mockResolvedValue(false)

        const request = new NextRequest('http://localhost/api/alternate-registrations', {
          method: 'POST',
          body: JSON.stringify({
            registrationId: 'reg-456',
            gameDescription: 'Test Game'
          })
        })
        const response = await POST(request)
        const data = await response.json()

        expect(response.status).toBe(403)
        expect(data.error).toBe('You do not have access to manage alternates for this registration')
        expect(canAccessRegistrationAlternates).toHaveBeenCalledWith('reg-456')
      })
    })

    describe('Regular users (non-captain, non-admin) cannot access any teams', () => {
      it('should block regular user from viewing games', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'regular-user-123' } }
        })

        // Mock access check - regular user has no access
        canAccessRegistrationAlternates.mockResolvedValue(false)

        const request = new NextRequest('http://localhost/api/alternate-registrations?registrationId=reg-123')
        const response = await GET(request)
        const data = await response.json()

        expect(response.status).toBe(403)
        expect(data.error).toBe('You do not have access to manage alternates for this registration')
      })

      it('should block regular user from creating games', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'regular-user-123' } }
        })

        // Mock access check - regular user has no access
        canAccessRegistrationAlternates.mockResolvedValue(false)

        const request = new NextRequest('http://localhost/api/alternate-registrations', {
          method: 'POST',
          body: JSON.stringify({
            registrationId: 'reg-123',
            gameDescription: 'Test Game'
          })
        })
        const response = await POST(request)
        const data = await response.json()

        expect(response.status).toBe(403)
        expect(data.error).toBe('You do not have access to manage alternates for this registration')
      })
    })

    describe('Admin can access all teams', () => {
      it('should allow admin to view games for any registration', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-123' } }
        })

        // Mock access check - admin has access to everything
        canAccessRegistrationAlternates.mockResolvedValue(true)

        // Mock registration lookup
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'reg-999',
                  name: 'Any Team',
                  allow_alternates: true,
                  alternate_price: 5000,
                  alternate_accounting_code: 'ALT001',
                  seasons: { name: 'Season 2024' }
                },
                error: null
              }))
            }))
          }))
        })

        // Mock games lookup
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => Promise.resolve({
                data: [],
                error: null
              }))
            }))
          }))
        })

        // Mock user_alternate_registrations count
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({
              data: [],
              error: null
            }))
          }))
        })

        const request = new NextRequest('http://localhost/api/alternate-registrations?registrationId=reg-999')
        const response = await GET(request)

        expect(response.status).toBe(200)
      })

      it('should allow admin to create games for any registration', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-123' } }
        })

        // Mock access check - admin has access
        canAccessRegistrationAlternates.mockResolvedValue(true)

        // Mock registration lookup
        mockSupabase.from.mockReturnValueOnce({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'reg-999',
                  name: 'Any Team',
                  allow_alternates: true,
                  alternate_price: 5000,
                  alternate_accounting_code: 'ALT001'
                },
                error: null
              }))
            }))
          }))
        })

        // Mock game creation
        mockSupabase.from.mockReturnValueOnce({
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  id: 'game-999',
                  registration_id: 'reg-999',
                  game_description: 'Admin Game',
                  created_by: 'admin-123'
                },
                error: null
              }))
            }))
          }))
        })

        const request = new NextRequest('http://localhost/api/alternate-registrations', {
          method: 'POST',
          body: JSON.stringify({
            registrationId: 'reg-999',
            gameDescription: 'Admin Game'
          })
        })
        const response = await POST(request)

        expect(response.status).toBe(200)
      })
    })
  })
})