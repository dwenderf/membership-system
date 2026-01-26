import { createClient } from '@/lib/supabase/server'
import { formatDate, formatTime, formatEventDateTime } from '@/lib/date-utils'
import { getCategoryRegistrationCounts } from '@/lib/registration-counts'
import { getRegistrationStatus } from '@/lib/registration-status'
import { RegistrationValidationService } from '@/lib/services/registration-validation-service'
import RegistrationPurchase from '@/components/RegistrationPurchase'
import RegistrationTypeBadge from '@/components/RegistrationTypeBadge'
import Link from 'next/link'

// Helper function to safely parse date strings without timezone conversion
function formatDateString(dateString: string): string {
  if (!dateString) return 'N/A'
  
  // Parse the date components manually to avoid timezone issues
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  
  return formatDate(date)
}



// Helper function to get timing message for coming soon registrations
function getTimingMessage(registration: any): string {
  const now = new Date()
  
  // Check if presale is configured and coming up
  if (registration.presale_start_at) {
    const presaleStart = new Date(registration.presale_start_at)
    if (now < presaleStart) {
      return `Pre-sale starts ${formatDate(presaleStart)} at ${formatTime(presaleStart)}`
    }
  }
  
  // Check regular start time
  if (registration.regular_start_at) {
    const regularStart = new Date(registration.regular_start_at)
    if (now < regularStart) {
      return `Registration opens ${formatDate(regularStart)} at ${formatTime(regularStart)}`
    }
  }
  
  return 'Registration timing not yet announced'
}

export default async function BrowseRegistrationsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Get user profile to check LGBTQ status
  const { data: userProfile } = await supabase
    .from('users')
    .select('is_lgbtq')
    .eq('id', user.id)
    .single()

  // Get user's active memberships to check eligibility
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select(`
      *,
      membership:memberships(*)
    `)
    .eq('user_id', user.id)
    .eq('payment_status', 'paid')
    .gte('valid_until', new Date().toISOString().split('T')[0])

  // Get user's existing registrations with category details
  const { data: userRegistrations } = await supabase
    .from('user_registrations')
    .select(`
      registration_id,
      registration_category_id,
      registration_category:registration_categories(
        id,
        categories:category_id(name)
      )
    `)
    .eq('user_id', user.id)
    .eq('payment_status', 'paid')

  // Get user's alternate registrations
  const { data: userAlternateRegistrations } = await supabase
    .from('user_alternate_registrations')
    .select('registration_id')
    .eq('user_id', user.id)

  // Get available registrations for current/future seasons
  // First get current/future seasons
  const { data: currentSeasons } = await supabase
    .from('seasons')
    .select('id')
    .gte('end_date', new Date().toISOString().split('T')[0])

  const seasonIds = currentSeasons?.map(s => s.id) || []

  const { data: availableRegistrations } = await supabase
    .from('registrations')
    .select(`
      *,
      season:seasons(*),
      memberships:required_membership_id(id, name),
      registration_categories(
        *,
        categories:category_id(name),
        memberships:required_membership_id(id, name)
      )
    `)
    .in('season_id', seasonIds)
    .order('created_at', { ascending: false })

  // Get paid registration counts for all categories using shared utility
  const allCategoryIds: string[] = []
  if (availableRegistrations) {
    availableRegistrations.forEach(reg => {
      if (reg.registration_categories) {
        reg.registration_categories.forEach((cat: any) => {
          allCategoryIds.push(cat.id)
        })
      }
    })
  }
  const categoryRegistrationCounts = await getCategoryRegistrationCounts(allCategoryIds)

  const activeMemberships = userMemberships || []
  
  // Consolidate memberships by type to show latest expiration (same logic as dashboard)
  const now = new Date()
  const consolidatedMemberships = activeMemberships.reduce((acc, um) => {
    const validUntil = new Date(um.valid_until)
    
    // Only include if still valid
    if (validUntil > now) {
      const membershipId = um.membership_id
      
      if (!acc[membershipId]) {
        acc[membershipId] = {
          membershipId,
          membership: um.membership,
          validFrom: um.valid_from,
          validUntil: um.valid_until,
          purchases: []
        }
      }
      
      // Update overall validity period
      if (um.valid_from < acc[membershipId].validFrom) {
        acc[membershipId].validFrom = um.valid_from
      }
      if (um.valid_until > acc[membershipId].validUntil) {
        acc[membershipId].validUntil = um.valid_until
      }
      
      acc[membershipId].purchases.push(um)
    }
    
    return acc
  }, {} as Record<string, any>)
  
  const consolidatedMembershipList = Object.values(consolidatedMemberships)
  const hasActiveMembership = consolidatedMembershipList.length > 0
  const userRegistrationIds = userRegistrations?.map(ur => ur.registration_id) || []
  const userAlternateRegistrationIds = userAlternateRegistrations?.map(uar => uar.registration_id) || []

  // Check if any memberships are expiring soon (≤90 days)
  const expiringSoonMemberships = consolidatedMembershipList.filter((consolidatedMembership: any) => {
    const validUntil = new Date(consolidatedMembership.validUntil)
    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiration <= 90
  })
  const hasExpiringSoonMemberships = expiringSoonMemberships.length > 0

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Header with back navigation */}
      <div className="mb-8">
        <div className="flex items-center space-x-2 mb-4">
          <Link 
            href="/user/registrations"
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back to My Registrations</span>
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Browse Registrations</h1>
        <p className="mt-2 text-sm text-gray-600">
          Search for and register for upcoming events, teams, and activities
        </p>
      </div>

      {/* Conditional Membership Warning - Only show if memberships are expiring soon */}
      {hasExpiringSoonMemberships && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <svg className="h-5 w-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <h3 className="text-sm font-medium text-yellow-800">
              Membership Expiring Soon
            </h3>
          </div>
          <div className="space-y-2">
            {expiringSoonMemberships.map((consolidatedMembership: any) => {
              const validUntil = new Date(consolidatedMembership.validUntil)
              const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              
              return (
                <div key={consolidatedMembership.membershipId} className="text-sm">
                  <span className="font-medium text-yellow-900">
                    {consolidatedMembership.membership?.name}
                  </span>
                  <span className="text-yellow-700 ml-2">
                    expires {formatDate(validUntil)} ({daysUntilExpiration} day{daysUntilExpiration !== 1 ? 's' : ''} remaining)
                  </span>
                </div>
              )
            })}
            <div className="mt-4">
              <Link 
                href="/user/browse-memberships" 
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
              >
                Extend Membership
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* No Active Memberships Warning - Only show if no memberships at all */}
      {!hasActiveMembership && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <svg className="h-5 w-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <h3 className="text-sm font-medium text-red-800">No Active Memberships</h3>
          </div>
          <div>
            <p className="text-xs text-red-700 mb-3">
              You need an active membership to register for most teams and events.
            </p>
            <Link 
              href="/user/browse-memberships" 
              className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
            >
              Get Membership
              <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* Available Registrations */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-6">Available Teams & Events</h2>
        
        {availableRegistrations && availableRegistrations.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {availableRegistrations
              .filter(reg => {
                const isAlreadyRegistered = userRegistrationIds.includes(reg.id)
                const status = getRegistrationStatus(reg)
                
                // Filter logic - show registrations that are:
                // - open (fully available)
                // - presale (visible but may require code)
                // - coming_soon (show with disabled state and timing info)
                // Hide registrations that are:
                // - draft (not published)
                // - expired (past end date)
                const shouldShow = status === 'open' || status === 'presale' || status === 'coming_soon'
                
                // For teams: show all (registered and unregistered) if timing allows
                // For events/scrimmages: hide if already registered (allow multiple) if timing allows
                return shouldShow && (reg.type === 'team' || !isAlreadyRegistered)
              })
              .map((registration) => {
                // Collect all qualifying membership IDs (registration-level + category-level)
                const registrationMembershipId = registration.required_membership_id || null
                const categoryMembershipIds = registration.registration_categories
                  ?.map((cat: any) => cat.required_membership_id)
                  .filter((id: string | null): id is string => id !== null) || []

                // Get unique category membership IDs
                const uniqueCategoryMembershipIds = [...new Set(categoryMembershipIds)]

                // Check if user has required membership using hierarchical validation
                // We need to check against each category since different categories may have different requirements
                let hasEligibleMembership = false
                let membershipValidationResult = null

                if (!registrationMembershipId && uniqueCategoryMembershipIds.length === 0) {
                  // No membership required at all
                  hasEligibleMembership = true
                } else {
                  // Check if user qualifies for any category
                  // A user is eligible if they have the registration-level membership OR any category-level membership
                  const allQualifyingIds = [
                    registrationMembershipId,
                    ...uniqueCategoryMembershipIds
                  ].filter((id): id is string => id !== null)

                  // Convert user memberships to the format expected by validation service
                  const userMembershipsForValidation = activeMemberships.map(um => ({
                    id: um.id,
                    membership_id: um.membership_id,
                    valid_from: um.valid_from,
                    valid_until: um.valid_until,
                    payment_status: um.payment_status as 'paid' | 'pending' | 'failed' | 'refunded',
                    memberships: um.membership ? {
                      id: um.membership.id,
                      name: um.membership.name
                    } : undefined
                  }))

                  // For eligibility check, we consider user eligible if they have ANY qualifying membership
                  // (This is more permissive than the per-category check done later in RegistrationPurchase)
                  hasEligibleMembership = allQualifyingIds.some(qualifyingId =>
                    userMembershipsForValidation.some(um => um.membership_id === qualifyingId)
                  )

                  // For detailed validation result (used for messaging), check with first category
                  // This gives us a validation result we can use to show helpful messages
                  const firstCategoryMembershipId = uniqueCategoryMembershipIds[0] || null
                  membershipValidationResult = RegistrationValidationService.validateMembershipRequirement(
                    registrationMembershipId,
                    firstCategoryMembershipId,
                    userMembershipsForValidation
                  )
                }

                const isAlreadyRegistered = userRegistrationIds.includes(registration.id)
                const registrationStatus = getRegistrationStatus(registration)

                // Find which category the user is registered for (if any)
                const userRegisteredCategory = userRegistrations?.find(ur => ur.registration_id === registration.id)

                // Sort registration_categories by sort_order, then by category name
                let sortedCategories = (registration.registration_categories || []).slice().sort((a: any, b: any) => {
                  if (a.sort_order !== b.sort_order) {
                    return (a.sort_order ?? 9999) - (b.sort_order ?? 9999)
                  }
                  // Fallback to alphabetical by category name
                  const nameA = a.categories?.name?.toLowerCase() || ''
                  const nameB = b.categories?.name?.toLowerCase() || ''
                  return nameA.localeCompare(nameB)
                })

                // If user is already registered for a category, only show that category + alternates
                if (userRegisteredCategory) {
                  sortedCategories = sortedCategories.filter((cat: any) => 
                    cat.id === userRegisteredCategory.registration_category_id || 
                    cat.categories?.name?.toLowerCase() === 'alternate'
                  )
                }

                return (
                  <div key={registration.id} className="bg-white overflow-hidden shadow rounded-lg transition-shadow">
                    <div className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Registration name as H3 */}
                          <h3 className="text-lg font-semibold text-gray-900">
                            {registration.name}
                          </h3>

                          {/* Date/Season as H4 */}
                          {(registration.type === 'event' || registration.type === 'scrimmage') && registration.start_date ? (
                            <h4 className="text-base text-gray-700 mt-1">
                              {formatEventDateTime(registration.start_date)}
                            </h4>
                          ) : (
                            <h4 className="text-base text-gray-700 mt-1">
                              {registration.season?.name}
                            </h4>
                          )}

                          {/* Status badges */}
                          <div className="mt-2 flex items-center space-x-2">
                            <RegistrationTypeBadge type={registration.type as 'team' | 'scrimmage' | 'event'} />
                            {registrationStatus === 'presale' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                Pre-Sale
                              </span>
                            )}
                            {registrationStatus === 'coming_soon' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                Coming Soon
                              </span>
                            )}
                          </div>

                          {/* Membership requirement message - show only if user doesn't have valid membership AND there are multiple qualifying options */}
                          {!hasEligibleMembership &&
                           registrationMembershipId &&
                           uniqueCategoryMembershipIds.length > 0 && (
                            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-md p-3">
                              <div className="flex items-start">
                                <svg className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-blue-800">
                                    Membership Required
                                  </p>
                                  <p className="text-xs text-blue-700 mt-1">
                                    You need either <span className="font-semibold">{registration.memberships?.name || 'registration-level membership'}</span> or{' '}
                                    {uniqueCategoryMembershipIds.length === 1 ? (
                                      <span className="font-semibold">
                                        {registration.registration_categories?.find((cat: any) =>
                                          cat.required_membership_id === uniqueCategoryMembershipIds[0]
                                        )?.memberships?.name || 'category-level membership'}
                                      </span>
                                    ) : (
                                      <span className="font-semibold">a category-specific membership</span>
                                    )}{' '}
                                    to register for this event.
                                  </p>
                                  <Link
                                    href="/user/browse-memberships"
                                    className="inline-flex items-center mt-2 text-xs font-medium text-blue-800 hover:text-blue-900"
                                  >
                                    View Available Memberships
                                    <svg className="ml-1 w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                  </Link>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-5">
                        {registrationStatus === 'coming_soon' ? (
                          // Coming Soon: Show timing information with disabled state
                          <div className="space-y-3">
                            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                              <div className="flex items-center">
                                <svg className="h-5 w-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                </svg>
                                <span className="text-sm font-medium text-yellow-800">
                                  Registration Not Yet Open
                                </span>
                              </div>
                              <p className="text-xs text-yellow-700 mt-1">
                                {getTimingMessage(registration)}
                              </p>
                            </div>
                            <button
                              disabled
                              className="w-full bg-gray-300 text-gray-500 px-4 py-2 rounded-md text-sm font-medium cursor-not-allowed"
                            >
                              Registration Opens Soon
                            </button>
                          </div>
                        ) : (
                          <RegistrationPurchase
                            registration={{
                              ...registration,
                              // Add current count to categories
                              registration_categories: sortedCategories.map((cat: any) => ({
                                ...cat,
                                current_count: categoryRegistrationCounts[cat.id] || 0
                              }))
                            }}
                            userEmail={user.email || ''}
                            activeMemberships={activeMemberships}
                            isEligible={hasEligibleMembership}
                            isLgbtq={userProfile?.is_lgbtq || false}
                            isAlreadyRegistered={isAlreadyRegistered}
                            isAlreadyAlternate={userAlternateRegistrationIds.includes(registration.id)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <div className="py-8">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4h4a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900">No registrations available</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Check back later for new teams and events.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              How registration works
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                • Most registrations require an active membership<br/>
                • Different categories may have different requirements<br/>
                • Registration opens at different times throughout the season<br/>
                • Some events have capacity limits and may fill up quickly
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}