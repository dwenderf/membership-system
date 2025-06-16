import { createClient } from '@/lib/supabase/server'

export default async function UserRegistrationsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Get user's registrations
  const { data: userRegistrations } = await supabase
    .from('user_registrations')
    .select(`
      *,
      registration:registrations(
        *,
        season:seasons(*),
        registration_categories(
          *,
          category:categories(name),
          membership:memberships(name)
        )
      )
    `)
    .eq('user_id', user.id)
    .order('registered_at', { ascending: false })

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

  // Get available registrations for current/future seasons
  const { data: availableRegistrations } = await supabase
    .from('registrations')
    .select(`
      *,
      season:seasons(*),
      registration_categories(
        *,
        category:categories(name),
        membership:memberships(name)
      )
    `)
    .gte('seasons.end_date', new Date().toISOString().split('T')[0])
    .order('seasons.start_date', { ascending: true })

  const activeMemberships = userMemberships || []
  const userRegistrationIds = userRegistrations?.map(ur => ur.registration_id) || []

  const currentRegistrations = userRegistrations?.filter(ur => {
    const season = ur.registration?.season
    if (!season) return false
    const endDate = new Date(season.end_date)
    return endDate >= new Date()
  }) || []

  const pastRegistrations = userRegistrations?.filter(ur => {
    const season = ur.registration?.season
    if (!season) return false
    const endDate = new Date(season.end_date)
    return endDate < new Date()
  }) || []

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Registrations</h1>
        <p className="mt-2 text-sm text-gray-600">
          View your current registrations and browse available teams and events
        </p>
      </div>

      {/* Current Registrations */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Current Registrations</h2>
        {currentRegistrations.length > 0 ? (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {currentRegistrations.map((userRegistration) => (
                <li key={userRegistration.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {userRegistration.registration?.name}
                          </p>
                          <p className="text-sm text-gray-600">
                            {userRegistration.registration?.season?.name}
                          </p>
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            userRegistration.payment_status === 'paid' 
                              ? 'bg-green-100 text-green-800'
                              : userRegistration.payment_status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {userRegistration.payment_status}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-900">
                          ${(userRegistration.amount_paid / 100).toFixed(2)}
                        </p>
                        <p className="text-sm text-gray-500">
                          Registered: {new Date(userRegistration.registered_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2">
                      <p className="text-sm text-gray-600">
                        Type: {userRegistration.registration?.type}
                      </p>
                      <p className="text-sm text-gray-500">
                        Season: {new Date(userRegistration.registration?.season?.start_date || '').toLocaleDateString()} - {new Date(userRegistration.registration?.season?.end_date || '').toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No current registrations</h3>
            <p className="mt-1 text-sm text-gray-500">
              You haven't registered for any current teams or events.
            </p>
          </div>
        )}
      </div>

      {/* Available Registrations */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Available Registrations</h2>
        {availableRegistrations && availableRegistrations.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {availableRegistrations
              .filter(reg => !userRegistrationIds.includes(reg.id))
              .map((registration) => {
                // Check if user has required memberships for any category
                const hasEligibleMembership = registration.registration_categories?.some(cat => {
                  if (!cat.membership?.name) return true // No membership required
                  return activeMemberships.some(um => um.membership?.name === cat.membership?.name)
                })

                return (
                  <div key={registration.id} className={`bg-white overflow-hidden shadow rounded-lg ${
                    hasEligibleMembership ? 'border-l-4 border-green-400' : 'border-l-4 border-yellow-400'
                  }`}>
                    <div className="p-5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                          {registration.name}
                        </h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
                          registration.type === 'scrimmage' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {registration.type}
                        </span>
                      </div>
                      
                      <div className="mt-2">
                        <p className="text-sm text-gray-600">
                          {registration.season?.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {new Date(registration.season?.start_date || '').toLocaleDateString()} - {new Date(registration.season?.end_date || '').toLocaleDateString()}
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
                                  {regCat.category?.name || regCat.custom_name}
                                </span>
                                <div className="flex items-center space-x-2">
                                  {regCat.membership?.name && (
                                    <span className="text-xs text-gray-500">
                                      Requires: {regCat.membership.name}
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

                      <div className="mt-4">
                        {hasEligibleMembership ? (
                          <button
                            disabled
                            className="w-full bg-gray-300 text-gray-500 px-4 py-2 rounded-md text-sm font-medium cursor-not-allowed"
                          >
                            Register (Coming Soon)
                          </button>
                        ) : (
                          <div>
                            <button
                              disabled
                              className="w-full bg-yellow-300 text-yellow-800 px-4 py-2 rounded-md text-sm font-medium cursor-not-allowed mb-2"
                            >
                              Membership Required
                            </button>
                            <p className="text-xs text-gray-500 text-center">
                              Purchase a membership to become eligible
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4h4a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No registrations available</h3>
            <p className="mt-1 text-sm text-gray-500">
              Check back later for new teams and events.
            </p>
          </div>
        )}
      </div>

      {/* Past Registrations */}
      {pastRegistrations.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-4">Past Registrations</h2>
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {pastRegistrations.map((userRegistration) => (
                <li key={userRegistration.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {userRegistration.registration?.name}
                        </p>
                        <p className="text-sm text-gray-600">
                          {userRegistration.registration?.season?.name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-900">
                          ${(userRegistration.amount_paid / 100).toFixed(2)}
                        </p>
                        <p className="text-sm text-gray-500">
                          Registered: {new Date(userRegistration.registered_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Membership Status Info */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              Membership Status
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                {activeMemberships.length > 0 
                  ? `You have ${activeMemberships.length} active membership${activeMemberships.length !== 1 ? 's' : ''}.`
                  : 'You need an active membership to register for most teams and events.'
                }
                {' '}
                <a href="/user/memberships" className="font-medium underline">
                  Manage your memberships →
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}