// Test file for the batched alternate registrations (games) API endpoint
import { GET } from '@/app/api/alternate-registrations/batch/route'
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
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis()
  }))
}

const mockLogger = {
  logSystem: jest.fn()
}

// Mock the imports
jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))
jest.requireMock('@/lib/logging/logger').logger = mockLogger

const { checkAlternatesAccess } = jest.requireMock('@/lib/utils/alternates-access')

describe('/api/alternate-registrations/batch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should require authentication', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const request = new NextRequest('http://localhost/api/alternate-registrations/batch?registrationIds=reg-1,reg-2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('should require registrationIds parameter', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } }
    })

    const request = new NextRequest('http://localhost/api/alternate-registrations/batch')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('registrationIds is required')
  })

  it('should require admin or captain access', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } }
    })

    checkAlternatesAccess.mockResolvedValue({
      hasAccess: false,
      isAdmin: false,
      isCaptain: false
    })

    const request = new NextRequest('http://localhost/api/alternate-registrations/batch?registrationIds=reg-1,reg-2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('You do not have access to manage alternates')
  })

  it('should fetch games for multiple registrations in a single query for admins', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin-123' } }
    })

    checkAlternatesAccess.mockResolvedValue({
      hasAccess: true,
      isAdmin: true,
      isCaptain: false
    })

    const gamesFromMock = jest.fn()
    const alternatesFromMock = jest.fn()

    mockSupabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve({
            data: [
              {
                id: 'game-1',
                registration_id: 'reg-1',
                game_description: 'Game 1',
                game_date: '2026-01-15T19:00:00Z',
                game_end_time: null,
                created_at: '2026-01-01T10:00:00Z',
                created_by: 'admin-123',
                alternate_selections: [{ id: 'sel-1' }]
              },
              {
                id: 'game-2',
                registration_id: 'reg-2',
                game_description: 'Game 2',
                game_date: '2026-01-16T19:00:00Z',
                game_end_time: null,
                created_at: '2026-01-02T10:00:00Z',
                created_by: 'admin-123',
                alternate_selections: []
              }
            ],
            error: null
          }))
        }))
      }))
    }))

    mockSupabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => Promise.resolve({
          data: [
            { id: 'ua-1', registration_id: 'reg-1' },
            { id: 'ua-2', registration_id: 'reg-1' },
            { id: 'ua-3', registration_id: 'reg-2' }
          ],
          error: null
        }))
      }))
    }))

    const request = new NextRequest('http://localhost/api/alternate-registrations/batch?registrationIds=reg-1,reg-2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabase.from).toHaveBeenCalledTimes(2)
    expect(Object.keys(data.games)).toEqual(['reg-1', 'reg-2'])
    expect(data.games['reg-1']).toHaveLength(1)
    expect(data.games['reg-1'][0].selectedCount).toBe(1)
    expect(data.games['reg-1'][0].availableCount).toBe(1) // 2 total - 1 selected
    expect(data.games['reg-2']).toHaveLength(1)
    expect(data.games['reg-2'][0].selectedCount).toBe(0)
    expect(data.games['reg-2'][0].availableCount).toBe(1) // 1 total - 0 selected
  })

  it('should scope requested registrations to what a captain can access', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'captain-123' } }
    })

    checkAlternatesAccess.mockResolvedValue({
      hasAccess: true,
      isAdmin: false,
      isCaptain: true,
      accessibleRegistrations: ['reg-1']
    })

    mockSupabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve({ data: [], error: null }))
        }))
      }))
    }))

    mockSupabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => Promise.resolve({ data: [], error: null }))
      }))
    }))

    const request = new NextRequest('http://localhost/api/alternate-registrations/batch?registrationIds=reg-1,reg-2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    // Only the accessible registration should be queried/returned
    expect(Object.keys(data.games)).toEqual(['reg-1'])
  })

  it('should return an empty map without querying when the captain has access to none of the requested registrations', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'captain-123' } }
    })

    checkAlternatesAccess.mockResolvedValue({
      hasAccess: true,
      isAdmin: false,
      isCaptain: true,
      accessibleRegistrations: ['reg-9']
    })

    const request = new NextRequest('http://localhost/api/alternate-registrations/batch?registrationIds=reg-1,reg-2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.games).toEqual({})
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })
})
