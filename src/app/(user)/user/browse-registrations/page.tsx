import { createClient } from '@/lib/supabase/server'
import { formatDate, formatEventDateTime } from '@/lib/date-utils'
import { getRegistrationStatus, RegistrationWithTiming } from '@/lib/registration-status'
import RegistrationTypeBadge from '@/components/RegistrationTypeBadge'
import Link from 'next/link'

interface RegistrationListItem extends RegistrationWithTiming {
  name: string
  season: {
    name: string
    start_date: string
    end_date: string
  } | null
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

  // Get user's existing registrations
  const { data: userRegistrations } = await supabase
    .from('user_registrations')
    .select('registration_id')
    .eq('user_id', user.id)
    .eq('payment_status', 'paid')

  // Get available registrations for current/future seasons
  const { data: currentSeasons } = await supabase
    .from('seasons')
    .select('id')
    .gte('end_date', new Date().toISOString().split('T')[0])

  const seasonIds = currentSeasons?.map(s => s.id) || []

  const { data: availableRegistrations } = await supabase
    .from('registrations')
    .select(`
      id,
      name,
      type,
      start_date,
      end_date,
      is_active,
      presale_start_at,
      regular_start_at,
      registration_end_at,
      presale_code,
      season:seasons(name, start_date, end_date)
    `)
    .in('season_id', seasonIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const activeMemberships = userMemberships || []
  const now = new Date()

  // Consolidate memberships by type to show latest expiration
  const consolidatedMemberships = activeMemberships.reduce((acc, um) => {
    const validUntil = new Date(um.valid_until)

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

  // Check if any memberships are expiring soon (<=90 days)
  const expiringSoonMemberships = consolidatedMembershipList.filter((consolidatedMembership: any) => {
    const validUntil = new Date(consolidatedMembership.validUntil)
    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiration <= 90
  })
  const hasExpiringSoonMemberships = expiringSoonMemberships.length > 0

  // Filter and categorize registrations
  const registrations = (availableRegistrations || []) as unknown as RegistrationListItem[]
  const filteredRegistrations = registrations.filter(reg => {
    const isAlreadyRegistered = userRegistrationIds.includes(reg.id)
    const status = getRegistrationStatus(reg)

    // Show registrations that are open, presale, or coming_soon
    // Hide draft and expired
    const shouldShow = status === 'open' || status === 'presale' || status === 'coming_soon'

    // For teams: show all (registered and unregistered)
    // For events/scrimmages: hide if already registered
    return shouldShow && (reg.type === 'team' || !isAlreadyRegistered)
  })

  // Separate coming soon from available
  const comingSoonRegistrations = filteredRegistrations.filter(reg =>
    getRegistrationStatus(reg) === 'coming_soon'
  )
  const availableNowRegistrations = filteredRegistrations.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'open' || status === 'presale'
  })

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

      {/* Coming Soon Section */}
      {comingSoonRegistrations.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Coming Soon</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {comingSoonRegistrations.map((registration) => (
              <Link
                key={registration.id}
                href={`/user/browse-registrations/${registration.id}`}
                className="group bg-gray-50 border border-gray-200 overflow-hidden shadow-sm rounded-lg p-5 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-medium text-gray-700 truncate">
                    {registration.name}
                  </h3>
                  {(registration.type === 'event' || registration.type === 'scrimmage') && registration.start_date ? (
                    <p className="text-sm text-gray-500 mt-1">
                      {formatEventDateTime(registration.start_date)}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500 mt-1">
                      {registration.season?.name}
                    </p>
                  )}
                  <div className="mt-2">
                    <RegistrationTypeBadge type={registration.type as 'team' | 'scrimmage' | 'event' | 'tournament'} />
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0 ml-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Available Registrations */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Available Teams & Events</h2>

        {availableNowRegistrations.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {availableNowRegistrations.map((registration) => (
              <Link
                key={registration.id}
                href={`/user/browse-registrations/${registration.id}`}
                className="group bg-white overflow-hidden shadow rounded-lg p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 truncate">
                    {registration.name}
                  </h3>
                  {(registration.type === 'event' || registration.type === 'scrimmage') && registration.start_date ? (
                    <p className="text-sm text-gray-600 mt-1">
                      {formatEventDateTime(registration.start_date)}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600 mt-1">
                      {registration.season?.name}
                    </p>
                  )}
                  <div className="mt-2">
                    <RegistrationTypeBadge type={registration.type as 'team' | 'scrimmage' | 'event' | 'tournament'} />
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 ml-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
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
    </div>
  )
}
