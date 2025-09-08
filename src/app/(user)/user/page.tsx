import { createClient } from '@/lib/supabase/server'
import { getCategoryDisplayName } from '@/lib/registration-utils'
import { headers } from 'next/headers'
import { getBaseUrl } from '@/lib/url-utils'
import { getOrganizationName } from '@/lib/organization'
import { getUserUnpaidInvoices } from '@/lib/invoice-utils'
import { formatAmount } from '@/lib/format-utils'
import DiscountUsage from '@/components/DiscountUsage'

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
      // Filter to only active registrations (where season hasn't expired)
      const activeRegistrations = allRegistrations.filter((reg: any) => {
        const season = reg.registration?.season
        if (!season) return false
        const endDate = new Date(season.end_date)
        return endDate >= new Date()
      })
      userRegistrations = activeRegistrations.slice(0, 5) // Limit to 5 for dashboard
    }
  } catch (error) {
    console.error('Error fetching user registrations:', error)
  }

  // Get user's alternate registrations
  const { data: userAlternateRegistrations } = await supabase
    .from('user_alternate_registrations')
    .select(`
      *,
      registration:registrations(
        id,
        name,
        season:seasons(name, start_date, end_date)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

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

  // Check for unpaid invoices (only for admins)
  const unpaidInvoices = userProfile?.is_admin 
    ? await getUserUnpaidInvoices(user.id)
    : { count: 0, totalAmount: 0 }

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Unpaid Invoices Warning - Only show for admins */}
      {userProfile?.is_admin && unpaidInvoices.count > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                You have {unpaidInvoices.count} unpaid invoice{unpaidInvoices.count !== 1 ? 's' : ''}
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <p>
                  Total outstanding: {formatAmount(unpaidInvoices.totalAmount)}. 
                  Please review and pay your invoices to avoid any service interruptions.
                </p>
              </div>
              <div className="mt-4">
                <a
                  href="/user/invoices"
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  View Invoices
                  <svg className="ml-2 -mr-0.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {userProfile?.first_name}!
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your {getOrganizationName('long').toLowerCase()} membership and registrations
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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

        {/* Active Registrations */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5 flex flex-col h-full">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Registrations
            </h3>
            <div className="flex-grow">
              {(userRegistrations && userRegistrations.length > 0) || (userAlternateRegistrations && userAlternateRegistrations.length > 0) || (userWaitlistEntries && userWaitlistEntries.length > 0) ? (
                <div className="mt-4 space-y-3">
                  {/* Show active registrations */}
                  {userRegistrations?.slice(0, 3).map((registration) => {
                    const isAlternate = userAlternateRegistrations?.some(alt => alt.registration?.id === registration.registration?.id)
                    return (
                      <div key={`reg-${registration.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {registration.registration?.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {registration.registration?.season?.name}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          {/* Category tag */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {getCategoryDisplayName(registration.registration_category)}
                          </span>
                          {/* Alternate tag if applicable */}
                          {isAlternate && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Alternate
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  
                  {/* Show alternate-only registrations (where user is alternate but not regular participant) */}
                  {userAlternateRegistrations?.filter(alt => {
                    // Only show if user is NOT already registered as regular participant
                    return !userRegistrations?.some(reg => reg.registration?.id === alt.registration?.id)
                  }).slice(0, 2).map((alternateReg) => {
                    // Filter to only active seasons
                    const season = alternateReg.registration?.season
                    if (!season) return null
                    const endDate = new Date(season.end_date)
                    if (endDate < new Date()) return null
                    
                    return (
                      <div key={`alt-${alternateReg.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {alternateReg.registration?.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {alternateReg.registration?.season?.name}
                          </p>
                        </div>
                        <div className="ml-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Alternate
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  
                  {/* Show active waitlist entries */}
                  {userWaitlistEntries?.filter(waitlistEntry => {
                    // Filter to only active seasons
                    const season = waitlistEntry.registration?.season
                    if (!season) return false
                    const endDate = new Date(season.end_date)
                    return endDate >= new Date()
                  }).slice(0, 2).map((waitlistEntry) => (
                    <div key={`wait-${waitlistEntry.id}`} className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {waitlistEntry.registration?.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {waitlistEntry.registration?.season?.name}
                        </p>
                      </div>
                      <div className="ml-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                          Waitlist
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-600">
                  No active registrations yet. Browse available registrations to get started.
                </p>
              )}
            </div>
            <div className="mt-5">
              <a
                href="/user/registrations"
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
              >
                View All Registrations
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Invoice Summary - Only show for admins */}
        {userProfile?.is_admin && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5 flex flex-col h-full">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className={`w-8 h-8 rounded-md flex items-center justify-center ${
                  unpaidInvoices.count > 0 ? 'bg-red-100' : 'bg-green-100'
                }`}>
                  <svg className={`w-5 h-5 ${
                    unpaidInvoices.count > 0 ? 'text-red-600' : 'text-green-600'
                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <div className="ml-3">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Invoices
                </h3>
              </div>
            </div>
            <div className="mt-4 flex-grow">
              {unpaidInvoices.count > 0 ? (
                <div className="space-y-3">
                  <div className="text-sm text-gray-600">
                    <p className="font-medium text-red-600">
                      {unpaidInvoices.count} unpaid invoice{unpaidInvoices.count !== 1 ? 's' : ''}
                    </p>
                    <p className="mt-1">
                      Total outstanding: {formatAmount(unpaidInvoices.totalAmount)}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500">
                    <p>Please review and pay your invoices to avoid service interruptions.</p>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">
                  <p className="font-medium text-green-600">All invoices paid</p>
                  <p className="mt-1">You're up to date with all your payments.</p>
                </div>
              )}
            </div>
            <div className="mt-5">
              <a
                href="/user/invoices"
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
              >
                View All Invoices
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        )}

        {/* Discount Usage */}
        <DiscountUsage />
      </div>

    </div>
  )
}