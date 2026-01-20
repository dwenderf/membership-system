import { createClient } from '@/lib/supabase/server'
import { getCategoryDisplayName } from '@/lib/registration-utils'
import { headers } from 'next/headers'
import { getBaseUrl } from '@/lib/url-utils'
import DiscountUsage from '@/components/DiscountUsage'
import RegistrationTypeBadge from '@/components/RegistrationTypeBadge'
import EventCalendarButton from '@/components/EventCalendarButton'
import { formatEventDateTime } from '@/lib/date-utils'

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
      // Filter to only active registrations
      const activeRegistrations = allRegistrations.filter((reg: any) => {
        const registration = reg.registration
        if (!registration) return false

        // For events and scrimmages with dates set, use the event end_date
        if ((registration.type === 'event' || registration.type === 'scrimmage') && registration.end_date) {
          const eventEndDate = new Date(registration.end_date)
          return eventEndDate >= new Date()
        }

        // For teams or events/scrimmages without dates, use season end_date
        const season = registration.season
        if (!season) return false
        const seasonEndDate = new Date(season.end_date)
        return seasonEndDate >= new Date()
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
        type,
        start_date,
        end_date,
        season:seasons(name, start_date, end_date)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

  // Get user's alternate selections (games they've been selected for and billed)
  const { data: userAlternateSelections } = await supabase
    .from('alternate_selections')
    .select(`
      *,
      alternate_registration:alternate_registrations(
        id,
        game_description,
        game_date,
        game_end_time,
        registration:registrations(
          id,
          name,
          type,
          start_date,
          end_date,
          season:seasons(name, start_date, end_date)
        )
      ),
      payment:payments(
        id,
        amount,
        created_at
      )
    `)
    .eq('user_id', user.id)
    .order('selected_at', { ascending: false })

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

  // Check for recently expired memberships (within 60 days)
  const recentlyExpiredMemberships = paidMemberships.filter(um => {
    const validUntil = new Date(um.valid_until)
    const daysSinceExpiration = Math.ceil((now.getTime() - validUntil.getTime()) / (1000 * 60 * 60 * 24))
    return validUntil <= now && daysSinceExpiration <= 60
  }).reduce((acc, um) => {
    // Group by membership type
    const membershipId = um.membership_id
    if (!acc[membershipId]) {
      acc[membershipId] = {
        membership: um.membership,
        validUntil: um.valid_until
      }
    }
    return acc
  }, {} as Record<string, any>)

  const recentlyExpired = Object.values(recentlyExpiredMemberships)

  // Check for expiring soon memberships (within 90 days)
  const expiringSoonMemberships = activeMemberships.filter((consolidatedMembership: any) => {
    const validUntil = new Date(consolidatedMembership.validUntil)
    const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiration <= 90
  })

  // Separate team registrations from event/scrimmage registrations
  const teamRegistrations = userRegistrations.filter((reg: any) => {
    const registration = reg.registration
    if (!registration) return false
    return registration.type === 'team'
  })

  const eventRegistrations = userRegistrations.filter((reg: any) => {
    const registration = reg.registration
    if (!registration) return false
    return registration.type === 'event' || registration.type === 'scrimmage'
  })

  return (
    <div className="px-4 py-3 sm:px-0">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          Welcome back, {userProfile?.first_name}!
        </h1>

        {/* Membership status subtitle */}
        <div className="mb-6 text-sm">
          {!hasActiveMembership && recentlyExpired.length === 0 ? (
            // No active or recently expired memberships
            <p className="text-gray-600">
              You do not have any active memberships.{' '}
              <a href="/user/browse-memberships" className="text-blue-600 hover:text-blue-800 underline">
                Click here to purchase
              </a>
            </p>
          ) : (
            <>
              {/* Show expiring soon memberships */}
              {expiringSoonMemberships.map((consolidatedMembership: any) => {
                const validUntil = new Date(consolidatedMembership.validUntil)
                const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                return (
                  <p key={`expiring-${consolidatedMembership.membershipId}`} className="text-amber-600">
                    ⚠️ Your {consolidatedMembership.membership?.name} expires in {daysUntilExpiration} day{daysUntilExpiration !== 1 ? 's' : ''}.{' '}
                    <a href="/user/browse-memberships" className="text-blue-600 hover:text-blue-800 underline">
                      Click here to extend
                    </a>
                  </p>
                )
              })}

              {/* Show recently expired memberships */}
              {recentlyExpired.map((expiredMembership: any) => (
                <p key={`expired-${expiredMembership.membership?.id}`} className="text-red-600">
                  Your {expiredMembership.membership?.name} has expired!{' '}
                  <a href="/user/browse-memberships" className="text-blue-600 hover:text-blue-800 underline">
                    Click here to renew
                  </a>
                </p>
              ))}
            </>
          )}
        </div>

        {/* Action Tiles - constrained to grid width */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
          <a
            href="/user/browse-memberships"
            className="group bg-white border-l-4 border-l-blue-600 overflow-hidden shadow rounded-lg p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center">
              <span className="mr-3 text-2xl">🎫</span>
              <span className="text-base font-medium text-gray-900">Browse Memberships</span>
            </div>
            <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a
            href="/user/browse-registrations"
            className="group bg-white border-l-4 border-l-blue-600 overflow-hidden shadow rounded-lg p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center">
              <span className="mr-3 text-2xl">🏒</span>
              <span className="text-base font-medium text-gray-900">Browse Registrations</span>
            </div>
            <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* My Teams */}
        <div className="bg-gray-50 overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              My Teams
            </h3>
            <div className="mt-4">
              {teamRegistrations.length > 0 ||
               userAlternateRegistrations?.some(alt => alt.registration?.type === 'team' && alt.registration?.season && new Date(alt.registration.season.end_date) >= now) ||
               userWaitlistEntries?.some(w => w.registration?.type === 'team' && w.registration?.season && new Date(w.registration.season.end_date) >= now) ? (
                <div className="space-y-3">
                  {/* Show team registrations */}
                  {teamRegistrations.map((registration: any) => {
                    const reg = registration.registration
                    const isAlternate = userAlternateRegistrations?.some(alt => alt.registration?.id === reg?.id)
                    const isWaitlist = userWaitlistEntries?.some(w => w.registration?.id === reg?.id)

                    return (
                      <div key={`team-reg-${registration.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {reg?.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {reg?.season?.name}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          <RegistrationTypeBadge type="team" />
                          {registration.registration_category && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              {getCategoryDisplayName(registration.registration_category)}
                            </span>
                          )}
                          {isAlternate && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Alternate
                            </span>
                          )}
                          {isWaitlist && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                              Waitlist
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Show alternate-only team registrations */}
                  {userAlternateRegistrations?.filter(alt => {
                    const registration = alt.registration
                    if (!registration || registration.type !== 'team') return false
                    if (!registration.season) return false
                    const seasonEndDate = new Date(registration.season.end_date)
                    if (seasonEndDate < now) return false
                    return !teamRegistrations.some((reg: any) => reg.registration?.id === registration.id)
                  }).map((alternateReg) => {
                    const registration = alternateReg.registration
                    if (!registration) return null
                    const isWaitlist = userWaitlistEntries?.some(w => w.registration?.id === registration.id)

                    return (
                      <div key={`team-alt-${alternateReg.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {registration.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {registration.season?.name}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          <RegistrationTypeBadge type="team" />
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Alternate
                          </span>
                          {isWaitlist && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                              Waitlist
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Show waitlist-only team registrations */}
                  {userWaitlistEntries?.filter(waitlist => {
                    const registration = waitlist.registration
                    if (!registration || registration.type !== 'team') return false
                    if (!registration.season) return false
                    const seasonEndDate = new Date(registration.season.end_date)
                    if (seasonEndDate < now) return false
                    // Only show if not already in team registrations or alternates
                    return !teamRegistrations.some((reg: any) => reg.registration?.id === registration.id) &&
                           !userAlternateRegistrations?.some(alt => alt.registration?.id === registration.id)
                  }).map((waitlistEntry) => {
                    const registration = waitlistEntry.registration
                    if (!registration) return null

                    return (
                      <div key={`team-wait-${waitlistEntry.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {registration.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {registration.season?.name}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          <RegistrationTypeBadge type="team" />
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                            Waitlist
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  No active team registrations.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* My Upcoming Events */}
        <div className="bg-gray-50 overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              My Upcoming Events
            </h3>
            <div className="mt-4">
              {eventRegistrations.length > 0 ||
               userAlternateSelections?.some(sel => {
                 const reg = sel.alternate_registration?.registration
                 const gameDate = sel.alternate_registration?.game_date
                 return reg && (reg.type === 'event' || reg.type === 'scrimmage') && gameDate && new Date(gameDate) >= now
               }) ||
               userWaitlistEntries?.some(w => {
                 const reg = w.registration
                 return reg && (reg.type === 'event' || reg.type === 'scrimmage') && reg.end_date && new Date(reg.end_date) >= now
               }) ? (
                <div className="space-y-3">
                  {/* Show event/scrimmage registrations */}
                  {eventRegistrations.map((registration: any) => {
                    const reg = registration.registration
                    const isWaitlist = userWaitlistEntries?.some(w => w.registration?.id === reg?.id)

                    return (
                      <div key={`event-reg-${registration.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {reg?.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {reg?.start_date ? formatEventDateTime(reg.start_date) : reg?.season?.name}
                          </p>
                          {reg?.start_date && reg?.end_date && (
                            <EventCalendarButton
                              eventName={reg.name}
                              startDate={reg.start_date}
                              endDate={reg.end_date}
                              description={`${reg.type.charAt(0).toUpperCase() + reg.type.slice(1)} - ${getCategoryDisplayName(registration.registration_category)}`}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          <RegistrationTypeBadge type={reg?.type as 'scrimmage' | 'event'} />
                          {registration.registration_category && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              {getCategoryDisplayName(registration.registration_category)}
                            </span>
                          )}
                          {isWaitlist && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                              Waitlist
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Show alternate selections for future games */}
                  {userAlternateSelections?.filter(sel => {
                    const altReg = sel.alternate_registration
                    const reg = altReg?.registration
                    if (!reg || (reg.type !== 'event' && reg.type !== 'scrimmage')) return false
                    const gameDate = altReg?.game_date
                    if (!gameDate || new Date(gameDate) < now) return false
                    // Only show if not already in event registrations
                    return !eventRegistrations.some((r: any) => r.registration?.id === reg.id)
                  }).map((selection) => {
                    const altReg = selection.alternate_registration
                    const reg = altReg?.registration
                    if (!reg || !altReg) return null

                    return (
                      <div key={`event-sel-${selection.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {reg.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatEventDateTime(altReg.game_date)}
                          </p>
                          {altReg.game_date && altReg.game_end_time && (
                            <EventCalendarButton
                              eventName={reg.name}
                              startDate={altReg.game_date}
                              endDate={altReg.game_end_time}
                              description={`${reg.type.charAt(0).toUpperCase() + reg.type.slice(1)} - Selected Alternate`}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          <RegistrationTypeBadge type={reg.type as 'scrimmage' | 'event'} />
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                            Selected
                          </span>
                        </div>
                      </div>
                    )
                  })}

                  {/* Show waitlist-only event registrations */}
                  {userWaitlistEntries?.filter(waitlist => {
                    const registration = waitlist.registration
                    if (!registration || (registration.type !== 'event' && registration.type !== 'scrimmage')) return false
                    if (!registration.end_date || new Date(registration.end_date) < now) return false
                    // Only show if not already in event registrations
                    return !eventRegistrations.some((reg: any) => reg.registration?.id === registration.id)
                  }).map((waitlistEntry) => {
                    const registration = waitlistEntry.registration
                    if (!registration) return null

                    return (
                      <div key={`event-wait-${waitlistEntry.id}`} className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {registration.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {registration.start_date ? formatEventDateTime(registration.start_date) : registration.season?.name}
                          </p>
                          {registration.start_date && registration.end_date && (
                            <EventCalendarButton
                              eventName={registration.name}
                              startDate={registration.start_date}
                              endDate={registration.end_date}
                              description={`${registration.type.charAt(0).toUpperCase() + registration.type.slice(1)} - Waitlist`}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 ml-2">
                          <RegistrationTypeBadge type={registration.type as 'scrimmage' | 'event'} />
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                            Waitlist
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  No upcoming events or scrimmages.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* My Discount Usage */}
        <DiscountUsage />
      </div>



    </div>
  )
}