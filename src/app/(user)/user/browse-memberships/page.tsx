import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { getMembershipStatus } from '@/lib/membership-status'

interface PageProps {
  searchParams: {
    from?: string
  }
}

export default async function BrowseMembershipsPage({ searchParams }: PageProps) {
  const { from } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null // Layout will handle redirect
  }

  // Get available membership types for purchase
  const { data: availableMemberships } = await supabase
    .from('memberships')
    .select('id, name, description')
    .order('name')

  // Get user's memberships for status display
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select(`
      *,
      membership:memberships(*)
    `)
    .eq('user_id', user.id)
    .order('valid_until', { ascending: false })

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Header with back navigation */}
      <div className="mb-8">
        <div className="flex items-center space-x-2 mb-4">
          <Link
            href="/user/memberships"
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back to My Memberships</span>
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Browse Memberships</h1>
      </div>

      {/* Available Memberships */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Available Membership Types</h2>

        {availableMemberships && availableMemberships.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {availableMemberships.map((membership) => {
              const membershipStatus = getMembershipStatus(membership.id, userMemberships || [])

              const detailUrl = from
                ? `/user/browse-memberships/${membership.id}?from=${encodeURIComponent(from)}`
                : `/user/browse-memberships/${membership.id}`

              return (
                <Link
                  key={membership.id}
                  href={detailUrl}
                  className="group bg-white overflow-hidden shadow rounded-lg p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer flex items-start justify-between"
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-gray-900 truncate">
                        {membership.name}
                      </h3>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${membershipStatus.className}`}>
                        {membershipStatus.label}
                      </span>
                    </div>
                    {membership.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {membership.description}
                      </p>
                    )}
                  </div>
                  <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="py-8">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m13-8-4 4-4-4m0 0L9 9l-4-4" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900">No memberships available</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Check back later or contact an administrator.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
