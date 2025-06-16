import { createClient } from '@/lib/supabase/server'

export default async function UserDashboardPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  // Get user's current memberships
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select(`
      *,
      membership:memberships(*)
    `)
    .eq('user_id', user.id)
    .eq('payment_status', 'paid')
    .gte('valid_until', new Date().toISOString().split('T')[0])
    .order('valid_until', { ascending: false })

  // Get user's current registrations
  const { data: userRegistrations } = await supabase
    .from('user_registrations')
    .select(`
      *,
      registration:registrations(
        *,
        season:seasons(*)
      )
    `)
    .eq('user_id', user.id)
    .order('registered_at', { ascending: false })
    .limit(5)

  const activeMemberships = userMemberships?.filter(um => {
    const now = new Date()
    const validUntil = new Date(um.valid_until)
    return validUntil > now
  }) || []

  const hasActiveMembership = activeMemberships.length > 0
  
  // Check if any active membership expires within 90 days
  const hasExpiringSoonMembership = activeMemberships.some(um => {
    const now = new Date()
    const validUntil = new Date(um.valid_until)
    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiration <= 90
  })

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {userProfile?.first_name}!
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your hockey association membership and registrations
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Membership Status */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  !hasActiveMembership 
                    ? 'bg-red-100 text-red-800'
                    : hasExpiringSoonMembership
                    ? 'bg-yellow-100 text-yellow-800' 
                    : 'bg-green-100 text-green-800'
                }`}>
                  {!hasActiveMembership 
                    ? 'No Active Membership'
                    : hasExpiringSoonMembership
                    ? 'Expiring Soon'
                    : 'Active Member'
                  }
                </div>
              </div>
            </div>
            <div className="mt-4">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Membership Status
              </h3>
              {hasActiveMembership ? (
                <div className="mt-2">
                  {activeMemberships.map((membership) => {
                    const now = new Date()
                    const validUntil = new Date(membership.valid_until)
                    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    const isExpiringSoon = daysUntilExpiration <= 90
                    
                    return (
                      <div key={membership.id} className="text-sm text-gray-600">
                        <strong>{membership.membership?.name}</strong>
                        <br />
                        Valid until: {validUntil.toLocaleDateString()}
                        {isExpiringSoon && (
                          <div className="text-yellow-600 font-medium mt-1">
                            ⚠️ Expires in {daysUntilExpiration} day{daysUntilExpiration !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-600">
                  You don't have an active membership. Purchase one to access registrations.
                </p>
              )}
            </div>
            <div className="mt-5">
              <a
                href="/user/memberships"
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                View all memberships →
              </a>
            </div>
          </div>
        </div>

        {/* Recent Registrations */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Recent Registrations
            </h3>
            {userRegistrations && userRegistrations.length > 0 ? (
              <div className="mt-4 space-y-3">
                {userRegistrations.slice(0, 3).map((registration) => (
                  <div key={registration.id} className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {registration.registration?.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {registration.registration?.season?.name}
                      </p>
                    </div>
                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      registration.payment_status === 'paid' 
                        ? 'bg-green-100 text-green-800'
                        : registration.payment_status === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {registration.payment_status}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-600">
                No registrations yet. Browse available registrations to get started.
              </p>
            )}
            <div className="mt-5">
              <a
                href="/user/registrations"
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                View all registrations →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <a
            href="/user/registrations"
            className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
          >
            <div className="flex-shrink-0">
              <div className="h-10 w-10 bg-green-500 rounded-lg flex items-center justify-center">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <span className="absolute inset-0" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-900">Browse Registrations</p>
              <p className="text-sm text-gray-500">Register for teams and events</p>
            </div>
          </a>

          <a
            href="/user/memberships"
            className="relative rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm flex items-center space-x-3 hover:border-gray-400 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
          >
            <div className="flex-shrink-0">
              <div className="h-10 w-10 bg-blue-500 rounded-lg flex items-center justify-center">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <span className="absolute inset-0" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-900">Manage Memberships</p>
              <p className="text-sm text-gray-500">View and purchase memberships</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}