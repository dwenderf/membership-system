import { createClient } from '@/lib/supabase/server'
// Removed formatDateString import - no longer needed
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function MembershipsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!userProfile?.is_admin) {
    redirect('/dashboard')
  }

  // Get all membership types
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching memberships:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Membership Management</h1>
              <p className="mt-1 text-sm text-gray-600">
                Create and manage flexible membership types with monthly and annual pricing
              </p>
            </div>
            <Link
              href="/admin/memberships/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Membership Type
            </Link>
          </div>

          {/* Memberships List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            {!memberships || memberships.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">No membership types created yet</div>
                <Link
                  href="/admin/memberships/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Create Your First Membership Type
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {memberships.map((membership: any) => {
                  const annualSavings = (membership.price_monthly * 12) - membership.price_annual
                  const annualSavingsPercent = ((annualSavings / (membership.price_monthly * 12)) * 100).toFixed(0)
                  
                  return (
                    <li key={membership.id}>
                      <div className="px-4 py-4 flex items-center justify-between">
                        <div className="flex items-center flex-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center">
                              <p className="text-lg font-medium text-gray-900 truncate">
                                {membership.name}
                              </p>
                              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Membership Type
                              </span>
                            </div>
                            {membership.description && (
                              <p className="mt-1 text-sm text-gray-600 truncate">
                                {membership.description}
                              </p>
                            )}
                            <div className="mt-1 flex items-center text-sm text-gray-500">
                              <span>${(membership.price_monthly / 100).toFixed(2)}/month</span>
                              <span className="mx-2">•</span>
                              <span>${(membership.price_annual / 100).toFixed(2)}/year</span>
                              {annualSavings > 0 && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span className="text-green-600">Save {annualSavingsPercent}% annually</span>
                                </>
                              )}
                              {membership.accounting_code && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span>Code: {membership.accounting_code}</span>
                                </>
                              )}
                              {!membership.allow_discounts && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span className="text-red-600">No Discounts</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-gray-400">
                            Created {new Date(membership.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Back to Admin Dashboard */}
          <div className="mt-6">
            <Link
              href="/admin"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}