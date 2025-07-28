import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface Membership {
  id: string
  name: string
  description: string | null
  accounting_code: string | null
  price_monthly: number
  price_annual: number
  allow_discounts: boolean
  created_at: string
}

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

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

  // Get all memberships
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
                Create and manage membership types
              </p>
              {memberships && memberships.length > 0 && (
                <div className="mt-3 flex items-center space-x-4 text-sm">
                  <span className="text-gray-600 font-medium">{memberships.length} membership types</span>
                  <span className="text-gray-400">•</span>
                  <span className="text-green-600 font-medium">
                    {memberships.filter(m => m.allow_discounts).length} allow discounts
                  </span>
                  {memberships.filter(m => !m.accounting_code).length > 0 && (
                    <>
                      <span className="text-gray-400">•</span>
                      <span className="text-red-600 font-medium">
                        {memberships.filter(m => !m.accounting_code).length} missing accounting codes
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <Link
              href="/admin/memberships/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Membership
            </Link>
          </div>

          {/* Memberships List */}
          {!memberships || memberships.length === 0 ? (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <div className="text-center py-12">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                  />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No membership types</h3>
                <p className="mt-1 text-sm text-gray-500">Get started by creating a new membership type.</p>
                <div className="mt-6">
                  <Link
                    href="/admin/memberships/new"
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Create New Membership
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {memberships.map((membership) => (
                  <li key={membership.id}>
                    <div className="px-4 py-4 flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center">
                            <p className="text-lg font-medium text-gray-900 truncate">
                              {membership.name}
                            </p>
                            <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              membership.allow_discounts 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {membership.allow_discounts ? 'Discounts Allowed' : 'No Discounts'}
                            </span>
                            {!membership.accounting_code && (
                              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                Missing Accounting Code
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center text-sm text-gray-500">
                            <span>Monthly: {formatCurrency(membership.price_monthly)}</span>
                            <span className="mx-2">•</span>
                            <span>Annual: {formatCurrency(membership.price_annual)}</span>
                            {membership.accounting_code && (
                              <>
                                <span className="mx-2">•</span>
                                <span>Code: {membership.accounting_code}</span>
                              </>
                            )}
                          </div>
                          {membership.description && (
                            <div className="mt-1 text-sm text-gray-600">
                              {membership.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <Link
                          href={`/admin/memberships/${membership.id}/edit`}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          Edit
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Return to Admin Link */}
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