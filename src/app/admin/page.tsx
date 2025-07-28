import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { getOrganizationName } from '@/lib/organization'

export default async function AdminDashboard() {
  const supabase = await createClient()

  // Get some basic stats
  const { count: totalUsers } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })

  // Only count seasons that are current or future (end_date >= today)
  const { count: totalSeasons } = await supabase
    .from('seasons')
    .select('*', { count: 'exact', head: true })
    .gte('end_date', new Date().toISOString().split('T')[0])

  const { count: totalMemberships } = await supabase
    .from('memberships')
    .select('*', { count: 'exact', head: true })

  const { count: totalRegistrations } = await supabase
    .from('registrations')
    .select('*', { count: 'exact', head: true })

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage your {getOrganizationName('long').toLowerCase()} membership system
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-medium">U</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Users</dt>
                      <dd className="text-lg font-medium text-gray-900">{totalUsers || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-medium">S</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Active/Future Seasons</dt>
                      <dd className="text-lg font-medium text-gray-900">{totalSeasons || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-medium">M</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Active Membership Types</dt>
                      <dd className="text-lg font-medium text-gray-900">{totalMemberships || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-medium">R</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Active Registrations</dt>
                      <dd className="text-lg font-medium text-gray-900">{totalRegistrations || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                Quick Actions
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Link
                  href="/admin/seasons"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Seasons</div>
                  <div className="mt-1 text-sm text-gray-500">Create and manage hockey seasons</div>
                </Link>

                <Link
                  href="/admin/memberships"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Membership Types</div>
                  <div className="mt-1 text-sm text-gray-500">Set up membership plans and pricing</div>
                </Link>

                <Link
                  href="/admin/registrations"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Registrations</div>
                  <div className="mt-1 text-sm text-gray-500">Create teams and events</div>
                </Link>

                <Link
                  href="/admin/registration-categories"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Registration Categories</div>
                  <div className="mt-1 text-sm text-gray-500">Configure master category templates</div>
                </Link>

                <Link
                  href="/admin/discount-categories"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Discounts</div>
                  <div className="mt-1 text-sm text-gray-500">Manage categories and discount codes</div>
                </Link>

                <Link
                  href="/admin/accounting-codes"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Accounting Codes</div>
                  <div className="mt-1 text-sm text-gray-500">Configure default codes and bulk updates</div>
                </Link>

                <Link
                  href="/admin/accounting"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Xero Integration</div>
                  <div className="mt-1 text-sm text-gray-500">Connect and manage Xero accounting</div>
                </Link>

                <Link
                  href="/admin/financial-reports"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Reports</div>
                  <div className="mt-1 text-sm text-gray-500">View system reports and analytics</div>
                </Link>

                <Link
                  href="/admin/logs"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">📊 System Logs</div>
                  <div className="mt-1 text-sm text-gray-500">Monitor application logs and system events</div>
                </Link>
              </div>
            </div>
          </div>

    </>
  )
}