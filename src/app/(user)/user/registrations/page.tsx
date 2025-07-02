import { createClient } from '@/lib/supabase/server'
import RegistrationHistory from '@/components/RegistrationHistory'
import Link from 'next/link'
import { getCategoryDisplayName } from '@/lib/registration-utils'
import { headers } from 'next/headers'
import { getBaseUrl } from '@/lib/url-utils'

// Helper function to safely parse date strings without timezone conversion
function formatDateString(dateString: string): string {
  if (!dateString) return 'N/A'
  
  // Parse the date components manually to avoid timezone issues
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  
  return date.toLocaleDateString()
}

export default async function UserRegistrationsPage() {
  const headersList = await headers()
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Get user's paid registrations only (via API for centralized logic)
  let userRegistrations: any[] = []
  try {
    const registrationsResponse = await fetch(`${getBaseUrl()}/api/user-registrations`, {
      headers: {
        'Cookie': headersList.get('cookie') || '',
      },
    })
    if (registrationsResponse.ok) {
      userRegistrations = await registrationsResponse.json()
    }
  } catch (error) {
    console.error('Error fetching user registrations:', error)
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

  // Get user's current waitlist entries
  const { data: userWaitlistEntries } = await supabase
    .from('waitlists')
    .select(`
      *,
      registration:registrations(
        *,
        season:seasons(*)
      ),
      registration_category:registration_categories(
        *,
        categories:category_id(name)
      )
    `)
    .eq('user_id', user.id)
    .is('removed_at', null)
    .order('joined_at', { ascending: false })

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

  // Split waitlist entries into current and past
  const currentWaitlistEntries = userWaitlistEntries?.filter(we => {
    const season = we.registration?.season
    if (!season) return false
    const endDate = new Date(season.end_date)
    return endDate >= new Date()
  }) || []

  const pastWaitlistEntries = userWaitlistEntries?.filter(we => {
    const season = we.registration?.season
    if (!season) return false
    const endDate = new Date(season.end_date)
    return endDate < new Date()
  }) || []

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Registrations</h1>
        <p className="mt-2 text-sm text-gray-600">
          View and manage your current and past registrations
        </p>
      </div>

      {/* Active Registrations */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Active Registrations</h2>
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
                        Season: {formatDateString(userRegistration.registration?.season?.start_date || '')} - {formatDateString(userRegistration.registration?.season?.end_date || '')}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="py-8">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-12 w-12 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900">No active registrations</h3>
                <p className="mt-1 text-sm text-gray-500">
                  You haven't registered for any active teams or events. Browse available options to get started.
                </p>
                <div className="mt-4">
                  <Link
                    href="/user/browse-registrations"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"
                  >
                    Browse Available Registrations
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Current Waitlist Entries */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Current Waitlists</h2>
        {currentWaitlistEntries.length > 0 ? (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {currentWaitlistEntries.map((waitlistEntry) => (
                <li key={waitlistEntry.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {waitlistEntry.registration?.name}
                          </p>
                          <p className="text-sm text-gray-600">
                            {waitlistEntry.registration?.season?.name} • {getCategoryDisplayName(waitlistEntry.registration_category)}
                          </p>
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Position #{waitlistEntry.position}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">
                          Joined: {new Date(waitlistEntry.joined_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2">
                      <p className="text-sm text-gray-600">
                        Type: {waitlistEntry.registration?.type}
                      </p>
                      <p className="text-sm text-gray-500">
                        Season: {formatDateString(waitlistEntry.registration?.season?.start_date || '')} - {formatDateString(waitlistEntry.registration?.season?.end_date || '')}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="py-4">
            <p className="text-sm text-gray-600">
              You are not currently on any waitlists.
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

      {/* Past Waitlist Entries */}
      {pastWaitlistEntries.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Past Waitlists</h2>
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {pastWaitlistEntries.map((waitlistEntry) => (
                <li key={waitlistEntry.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {waitlistEntry.registration?.name}
                        </p>
                        <p className="text-sm text-gray-600">
                          {waitlistEntry.registration?.season?.name} • {getCategoryDisplayName(waitlistEntry.registration_category)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">
                          Position #{waitlistEntry.position}
                        </p>
                        <p className="text-sm text-gray-500">
                          Joined: {new Date(waitlistEntry.joined_at).toLocaleDateString()}
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

      {/* Registration History - Show all registrations */}
      {userRegistrations && userRegistrations.length > 0 && (
        <RegistrationHistory userRegistrations={userRegistrations} />
      )}

      {/* Call to Action for Browsing - Only show if user has registrations */}
      {currentRegistrations.length > 0 && (
        <div className="mt-8 bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-green-800">
                Looking for new teams or events?
              </h3>
              <div className="mt-2 text-sm text-green-700">
                <p>
                  Browse available registrations for upcoming seasons and register for teams, events, and activities.
                </p>
              </div>
              <div className="mt-4">
                <Link
                  href="/user/browse-registrations"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"
                >
                  Browse Registrations
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}