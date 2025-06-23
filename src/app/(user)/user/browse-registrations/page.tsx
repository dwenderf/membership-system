import { createClient } from '@/lib/supabase/server'
import RegistrationPurchase from '@/components/RegistrationPurchase'
import Link from 'next/link'

// Helper function to safely parse date strings without timezone conversion
function formatDateString(dateString: string): string {
  if (!dateString) return 'N/A'
  
  // Parse the date components manually to avoid timezone issues
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  
  return date.toLocaleDateString()
}

// Helper function to get price for a registration category (simplified)
function getCategoryPrice(category: any): { price: number; tierName: string } {
  // Use the price directly from the category
  return { 
    price: category.price || 5000, // Default to $50.00 if no price set
    tierName: 'Standard' 
  }
}

export default async function BrowseRegistrationsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

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

  // Get user's existing registrations to filter out
  const { data: userRegistrations } = await supabase
    .from('user_registrations')
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
      registration_categories(
        *,
        categories:category_id(name),
        memberships:required_membership_id(name)
      )
    `)
    .in('season_id', seasonIds)
    .order('created_at', { ascending: false })

  const activeMemberships = userMemberships || []
  const userRegistrationIds = userRegistrations?.map(ur => ur.registration_id) || []

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

      {/* Membership Status Alert */}
      <div className={`mb-6 border rounded-lg p-4 ${
        activeMemberships.length > 0 
          ? 'bg-green-50 border-green-200' 
          : 'bg-yellow-50 border-yellow-200'
      }`}>
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className={`h-5 w-5 ${
              activeMemberships.length > 0 ? 'text-green-400' : 'text-yellow-400'
            }`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className={`text-sm font-medium ${
              activeMemberships.length > 0 ? 'text-green-800' : 'text-yellow-800'
            }`}>
              Membership Status
            </h3>
            <div className={`mt-2 text-sm ${
              activeMemberships.length > 0 ? 'text-green-700' : 'text-yellow-700'
            }`}>
              <p>
                {activeMemberships.length > 0 
                  ? `You have ${activeMemberships.length} active membership${activeMemberships.length !== 1 ? 's' : ''} and can register for eligible events.`
                  : 'You need an active membership to register for most teams and events.'
                }
                {' '}
                <Link href="/user/browse-memberships" className="font-medium underline">
                  {activeMemberships.length > 0 ? 'Manage memberships' : 'Browse memberships'} →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Available Registrations */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-6">Available Teams & Events</h2>
        
        {availableRegistrations && availableRegistrations.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {availableRegistrations
              .filter(reg => !userRegistrationIds.includes(reg.id))
              .map((registration) => {
                // Check if user has required memberships for any category
                const hasEligibleMembership = registration.registration_categories?.some(cat => {
                  if (!cat.memberships?.name) return true // No membership required
                  return activeMemberships.some(um => um.membership?.name === cat.memberships?.name)
                })

                const isAlreadyRegistered = userRegistrationIds.includes(registration.id)

                return (
                  <div key={registration.id} className={`bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow ${
                    isAlreadyRegistered 
                      ? 'border-l-4 border-blue-400' 
                      : hasEligibleMembership 
                      ? 'border-l-4 border-green-400' 
                      : 'border-l-4 border-yellow-400'
                  }`}>
                    <div className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg leading-6 font-medium text-gray-900">
                            {registration.name}
                          </h3>
                          <div className="mt-1 flex items-center space-x-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
                              registration.type === 'scrimmage' ? 'bg-purple-100 text-purple-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {registration.type}
                            </span>
                            {isAlreadyRegistered && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                Registered
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-3">
                        <p className="text-sm font-medium text-gray-900">
                          {registration.season?.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {formatDateString(registration.season?.start_date || '')} - {formatDateString(registration.season?.end_date || '')}
                        </p>
                      </div>

                      {/* Categories */}
                      {registration.registration_categories && registration.registration_categories.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-gray-900 mb-2">Available Categories:</h4>
                          <div className="space-y-1">
                            {registration.registration_categories.map((regCat) => (
                              <div key={regCat.id} className="flex justify-between items-center text-sm">
                                <span className="text-gray-600">
                                  {regCat.categories?.name || regCat.custom_name}
                                </span>
                                <div className="flex items-center space-x-2">
                                  {regCat.memberships?.name && (
                                    <span className="text-xs text-gray-500">
                                      Requires: {regCat.memberships.name}
                                    </span>
                                  )}
                                  {regCat.max_capacity && (
                                    <span className="text-xs text-gray-500">
                                      Cap: {regCat.max_capacity}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-5">
                        {isAlreadyRegistered ? (
                          <Link
                            href="/user/registrations"
                            className="w-full bg-blue-100 text-blue-800 px-4 py-2 rounded-md text-sm font-medium text-center block"
                          >
                            View in My Registrations
                          </Link>
                        ) : (
                          <RegistrationPurchase
                            registration={{
                              ...registration,
                              // Pre-calculate pricing for all categories
                              registration_categories: registration.registration_categories?.map(cat => ({
                                ...cat,
                                pricing: getCategoryPrice(cat)
                              })) || []
                            }}
                            userEmail={user.email || ''}
                            activeMemberships={activeMemberships}
                            isEligible={hasEligibleMembership}
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