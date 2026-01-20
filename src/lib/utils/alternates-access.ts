import { createClient } from '@/lib/supabase/server'

export interface AlternatesAccessResult {
  hasAccess: boolean
  isAdmin: boolean
  isCaptain: boolean
  accessibleRegistrations?: string[] // Registration IDs captain can access
}

/**
 * Check if user has access to manage alternates
 * Supports both admin and captain access
 */
export async function checkAlternatesAccess(): Promise<AlternatesAccessResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      hasAccess: false,
      isAdmin: false,
      isCaptain: false
    }
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  const isAdmin = userProfile?.is_admin || false

  // Check if user is a captain of any registrations
  const { data: captainRegistrations } = await supabase
    .from('registration_captains')
    .select('registration_id')
    .eq('user_id', user.id)

  const isCaptain = (captainRegistrations?.length ?? 0) > 0
  const accessibleRegistrations = captainRegistrations?.map(rc => rc.registration_id) || []

  return {
    hasAccess: isAdmin || isCaptain,
    isAdmin,
    isCaptain,
    accessibleRegistrations: isAdmin ? undefined : accessibleRegistrations // undefined = all registrations for admin
  }
}

/**
 * Check if user can access a specific registration's alternates
 */
export async function canAccessRegistrationAlternates(registrationId: string): Promise<boolean> {
  const access = await checkAlternatesAccess()

  if (!access.hasAccess) return false

  // Admins can access all registrations
  if (access.isAdmin) return true

  // Captain can access their assigned registrations
  if (access.isCaptain && access.accessibleRegistrations) {
    return access.accessibleRegistrations.includes(registrationId)
  }

  return false
}

/**
 * Check if current user is a captain for a specific registration
 */
export async function checkCaptainAccess(registrationId: string): Promise<{
  isCaptain: boolean
  isAdmin: boolean
  hasAccess: boolean
}> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      isCaptain: false,
      isAdmin: false,
      hasAccess: false
    }
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  const isAdmin = userProfile?.is_admin || false

  // Check if user is a captain of this specific registration
  const { data: captainRecord } = await supabase
    .from('registration_captains')
    .select('id')
    .eq('user_id', user.id)
    .eq('registration_id', registrationId)
    .single()

  const isCaptain = !!captainRecord

  return {
    isCaptain,
    isAdmin,
    hasAccess: isAdmin || isCaptain
  }
}