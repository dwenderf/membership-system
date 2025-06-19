import { createClient } from '@/lib/supabase/server'
import MembershipPurchase from '@/components/MembershipPurchase'
import PurchaseHistory from '@/components/PurchaseHistory'

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

  // Get available membership types for purchase
  const { data: availableMemberships } = await supabase
    .from('memberships')
    .select('*')
    .order('name')

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

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Memberships</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your hockey association memberships and purchase new ones
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
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Valid From:</span>
                          <span className="text-gray-900">
                            {new Date(consolidatedMembership.validFrom).toLocaleDateString()}
                          </span>
                        </div>
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
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No active memberships</h3>
            <p className="mt-1 text-sm text-gray-500">
              You don't have any active memberships. Purchase one below to access registrations.
            </p>
          </div>
        )}
      </div>

      {/* Purchase History */}
      <PurchaseHistory userMemberships={userMemberships || []} />

      {/* Available Memberships for Purchase */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Available Memberships</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {availableMemberships?.map((membership) => (
            <div key={membership.id} className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  {membership.name}
                </h3>
                {membership.description && (
                  <p className="mt-2 text-sm text-gray-600">
                    {membership.description}
                  </p>
                )}
                <MembershipPurchase 
                  membership={membership} 
                  userMemberships={userMemberships}
                />
              </div>
            </div>
          ))}
        </div>
        {(!availableMemberships || availableMemberships.length === 0) && (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m13-8-4 4-4-4m0 0L9 9l-4-4" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No memberships available</h3>
            <p className="mt-1 text-sm text-gray-500">
              Check back later or contact an administrator.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}