import { createClient } from '@/lib/supabase/server'
import MembershipPurchase from '@/components/MembershipPurchase'
import Link from 'next/link'
import { getMembershipStatus } from '@/lib/membership-status'

export default async function BrowseMembershipsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Get available membership types for purchase
  const { data: availableMemberships } = await supabase
    .from('memberships')
    .select('*')
    .order('name')

  // Get user's memberships for the purchase component
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
        <p className="mt-2 text-sm text-gray-600">
          Search for and purchase new memberships or extend your existing ones
        </p>
      </div>

      {/* Available Memberships for Purchase */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-6">Available Membership Types</h2>
        
        {availableMemberships && availableMemberships.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {availableMemberships.map((membership) => {
              const membershipStatus = getMembershipStatus(membership.id, userMemberships || [])
              
              return (
                <div key={membership.id} className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg leading-6 font-medium text-gray-900">
                            {membership.name}
                          </h3>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${membershipStatus.className}`}>
                            {membershipStatus.label}
                          </span>
                        </div>
                        {membership.description && (
                          <p className="mt-2 text-sm text-gray-600">
                            {membership.description}
                          </p>
                        )}
                      </div>
                    </div>
                  
                  {/* Pricing Display */}
                  <div className="mt-4 border-t border-gray-200 pt-4">
                    {membership.allow_monthly ? (
                      <>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500">Monthly:</span>
                          <span className="font-medium text-gray-900">
                            ${(membership.price_monthly / 100).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-1">
                          <span className="text-gray-500">Annual:</span>
                          <div className="text-right">
                            <span className="font-medium text-gray-900">
                              ${(membership.price_annual / 100).toFixed(2)}
                            </span>
                            {membership.allow_monthly && membership.price_annual < membership.price_monthly * 12 && (
                              <div className="text-xs text-green-600">
                                Save ${((membership.price_monthly * 12 - membership.price_annual) / 100).toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">Annual Only:</span>
                        <span className="font-medium text-gray-900">
                          ${(membership.price_annual / 100).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Purchase Component */}
                  <div className="mt-6">
                    <MembershipPurchase 
                      membership={membership} 
                      userEmail={user.email || ''}
                      userMemberships={userMemberships || []}
                    />
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
              Questions about memberships?
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                • Annual memberships offer savings and cover multiple seasons<br/>
                • Memberships can be extended seamlessly without gaps<br/>
                • Active memberships are required for most registrations
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}