// Regression coverage for issue #295: a session for an account with
// deleted_at set must never be allowed through, even though the normal
// deletion path never leaves such a session valid (see delete-account.test.ts) -
// this is the defense-in-depth backstop for stale/manually-edited data.

import { proxy } from '@/proxy'
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(),
}))

const mockCreateServerClient = createServerClient as jest.Mock

interface UserProfile {
  onboarding_completed_at: string | null
  deleted_at: string | null
  is_admin?: boolean
}

const makeSupabase = (user: { id: string } | null, userProfile: UserProfile | null) => ({
  auth: {
    getUser: jest.fn().mockResolvedValue({ data: { user } }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
  },
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({ data: userProfile }),
      })),
    })),
  })),
})

describe('proxy - deleted account enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('signs the user out and redirects to login when their account is deleted', async () => {
    const supabase = makeSupabase(
      { id: 'user-1' },
      { onboarding_completed_at: '2024-01-01T00:00:00Z', deleted_at: '2024-06-01T00:00:00Z' }
    )
    mockCreateServerClient.mockReturnValue(supabase)

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('http://localhost/auth/login')
  })

  it('does not block or sign out a live, non-deleted account', async () => {
    const supabase = makeSupabase(
      { id: 'user-1' },
      { onboarding_completed_at: '2024-01-01T00:00:00Z', deleted_at: null }
    )
    mockCreateServerClient.mockReturnValue(supabase)

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(supabase.auth.signOut).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBeNull()
  })

  it('still redirects an unauthenticated visitor to login on a protected route without touching deleted_at', async () => {
    const supabase = makeSupabase(null, null)
    mockCreateServerClient.mockReturnValue(supabase)

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(supabase.from).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('http://localhost/auth/login')
  })

  it('does not check deleted_at on whitelisted pages like /auth/login itself', async () => {
    const supabase = makeSupabase({ id: 'user-1' }, { onboarding_completed_at: null, deleted_at: '2024-06-01T00:00:00Z' })
    mockCreateServerClient.mockReturnValue(supabase)

    const response = await proxy(new NextRequest('http://localhost/auth/login'))

    expect(supabase.auth.signOut).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBeNull()
  })
})
