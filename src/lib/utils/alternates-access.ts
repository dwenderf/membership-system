import { createClient } from '@/lib/supabase/server'

export interface AlternatesAccessResult {
  hasAccess: boolean
  isAdmin: boolean
  isCaptain: boolean
  accessibleRegistrations?: string[] // Registration IDs captain can access
}

/**
 * Check if user has access to manage alternates
 * Currently admin-only, but designed to support captain access later
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

  // For now, only admins have access
  // TODO: Add captain access logic here when needed
  // This would involve checking user_registrations table for captain role
  
  return {
    hasAccess: isAdmin,
    isAdmin,
    isCaptain: false, // Will be implemented later
    accessibleRegistrations: isAdmin ? undefined : [] // undefined = all registrations for admin
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
  
  // Captain access logic (for future implementation)
  if (access.isCaptain && access.accessibleRegistrations) {
    return access.accessibleRegistrations.includes(registrationId)
  }
  
  return false
}