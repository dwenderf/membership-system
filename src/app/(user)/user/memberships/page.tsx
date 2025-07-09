import { createClient } from '@/lib/supabase/server'
import PurchaseHistory from '@/components/PurchaseHistory'
import Link from 'next/link'
import { consolidateUserMemberships } from '@/lib/membership-status'

export default async function UserMembershipsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Get user's memberships
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select(`
      *,
      membership:memberships(*)
    `)
    .eq('user_id', user.id)
    .order('valid_until', { ascending: false })


  const now = new Date()
  const activeMemberships = consolidateUserMemberships(userMemberships || [])

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Memberships</h1>
        <p className="mt-2 text-sm text-gray-600">
          View and manage your current hockey association memberships
        </p>
      </div>

      {/* Active Memberships - Consolidated View */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Active Memberships</h2>
        {activeMemberships.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activeMemberships.map((consolidatedMembership) => {
              const validUntil = new Date(consolidatedMembership.validUntil)
              const daysUntilExpiration = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              const isExpiringSoon = daysUntilExpiration <= 90
              
              return (
                <div key={consolidatedMembership.membershipId} className={`bg-white overflow-hidden shadow rounded-lg border-l-4 ${
                  isExpiringSoon ? 'border-yellow-400' : 'border-green-400'
                }`}>
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          isExpiringSoon ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {isExpiringSoon ? 'Expiring Soon' : 'Active'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <h3 className="text-lg leading-6 font-medium text-gray-900">
                        {consolidatedMembership.membership?.name}
                      </h3>
                      {consolidatedMembership.membership?.description && (
                        <p className="mt-1 text-sm text-gray-600">
                          {consolidatedMembership.membership.description}
                        </p>
                      )}
                      <div className="mt-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Valid Until:</span>
                          <span className="text-gray-900">
                            {validUntil.toLocaleDateString()}
                          </span>
                        </div>
                        {isExpiringSoon && (
                          <div className="text-yellow-600 font-medium text-sm">
                            ⚠️ Expires in {daysUntilExpiration} day{daysUntilExpiration !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
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
                <svg className="h-12 w-12 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900">No active memberships</h3>
                <p className="mt-1 text-sm text-gray-500">
                  You don't have any active memberships. Purchase a membership to access teams and events.
                </p>
                <div className="mt-4">
                  <Link
                    href="/user/browse-memberships"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Browse Memberships
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Purchase History */}
      <PurchaseHistory userMemberships={userMemberships || []} />

      {/* Call to Action for Purchasing - Only show if user has memberships */}
      {activeMemberships.length > 0 && (
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-blue-800">
                Need a new membership?
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <p>
                  Browse available membership types and purchase new memberships or extend your existing ones.
                </p>
              </div>
              <div className="mt-4">
                <Link
                  href="/user/browse-memberships"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Browse Memberships
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}