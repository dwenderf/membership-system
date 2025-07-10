import { createClient } from '@/lib/supabase/server'
import { getCategoryDisplayName } from '@/lib/registration-utils'
import { headers } from 'next/headers'
import { getBaseUrl } from '@/lib/url-utils'

export default async function UserDashboardPage() {
  const headersList = await headers()
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

  // Get user's current paid registrations only (via API for centralized logic)
  let userRegistrations: any[] = []
  try {
    const registrationsResponse = await fetch(`${getBaseUrl()}/api/user-registrations`, {
      headers: {
        'Cookie': headersList.get('cookie') || '',
      },
    })
    if (registrationsResponse.ok) {
      const allRegistrations = await registrationsResponse.json()
      userRegistrations = allRegistrations.slice(0, 5) // Limit to 5 for dashboard
    }
  } catch (error) {
    console.error('Error fetching user registrations:', error)
  }

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
    .limit(5)

  const now = new Date()
  
  // Get all paid memberships for processing
  const paidMemberships = userMemberships?.filter(um => um.payment_status === 'paid') || []
  
  // Consolidate active memberships by type
  const consolidatedMemberships = paidMemberships.reduce((acc, um) => {
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
  
  const activeMemberships = Object.values(consolidatedMemberships)
  const hasActiveMembership = activeMemberships.length > 0
  
  // Check for expired memberships
  const expiredMemberships = paidMemberships.filter(um => {
    const validUntil = new Date(um.valid_until)
    return validUntil <= now
  })
  const hasExpiredMembership = expiredMemberships.length > 0
  
  // Check if any active membership expires within 90 days
  const expiringSoonMemberships = activeMemberships.filter((consolidated: any) => {
    const validUntil = new Date(consolidated.validUntil)
    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiration <= 90
  })
  const hasExpiringSoonMembership = expiringSoonMemberships.length > 0

  return (
    <div className="px-4 py-6 sm:px-0 min-h-full">
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
          <div className="p-5 flex flex-col h-full">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  !hasActiveMembership 
                    ? 'bg-red-100 text-red-800'
                    : hasExpiredMembership
                    ? 'bg-red-100 text-red-800'
                    : hasExpiringSoonMembership
                    ? 'bg-yellow-100 text-yellow-800' 
                    : 'bg-green-100 text-green-800'
                }`}>
                  {!hasActiveMembership 
                    ? 'No Active Membership'
                    : hasExpiredMembership
                    ? 'Membership Expired'
                    : hasExpiringSoonMembership
                    ? 'Expiring Soon'
                    : 'Active Member'
                  }
                </div>
              </div>
            </div>
            <div className="mt-4 flex-grow">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Membership Status
              </h3>
              {hasActiveMembership ? (
                <div className="mt-2">
                  {activeMemberships.map((consolidatedMembership: any) => {
                    const validUntil = new Date(consolidatedMembership.validUntil)
                    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    const isExpiringSoon = daysUntilExpiration <= 90
                    
                    return (
                      <div key={consolidatedMembership.membershipId} className="text-sm text-gray-600">
                        <strong>{consolidatedMembership.membership?.name}</strong>
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
              {!hasActiveMembership ? (
                // No active memberships - encourage purchase
                <a
                  href="/user/browse-memberships"
                  className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
                >
                  Get Membership
                  <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </a>
              ) : hasExpiredMembership ? (
                // Has expired memberships - encourage renewal
                <a
                  href="/user/browse-memberships"
                  className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
                >
                  Renew Membership
                  <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </a>
              ) : hasExpiringSoonMembership ? (
                // Has expiring soon memberships - encourage extension
                <a
                  href="/user/browse-memberships"
                  className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
                >
                  Extend Membership
                  <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </a>
              ) : (
                // Healthy memberships - browse for more
                <a
                  href="/user/browse-memberships"
                  className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
                >
                  Browse Memberships
                  <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Recent Registrations */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5 flex flex-col h-full">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Recent Registrations & Waitlists
            </h3>
            <div className="flex-grow">
              {(userRegistrations && userRegistrations.length > 0) || (userWaitlistEntries && userWaitlistEntries.length > 0) ? (
                <div className="mt-4 space-y-3">
                  {/* Show recent registrations */}
                  {userRegistrations?.slice(0, 2).map((registration) => (
                    <div key={`reg-${registration.id}`} className="flex justify-between">
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
                  
                  {/* Show recent waitlist entries */}
                  {userWaitlistEntries?.slice(0, 2).map((waitlistEntry) => (
                    <div key={`wait-${waitlistEntry.id}`} className="flex justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {waitlistEntry.registration?.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {waitlistEntry.registration?.season?.name} • {getCategoryDisplayName(waitlistEntry.registration_category)}
                        </p>
                      </div>
                      <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Waitlist #{waitlistEntry.position}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-600">
                  No registrations or waitlists yet. Browse available registrations to get started.
                </p>
              )}
            </div>
            <div className="mt-5">
              <a
                href="/user/browse-registrations"
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
              >
                Browse Available Registrations
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}