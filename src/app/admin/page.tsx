import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AdminHeader from '@/components/AdminHeader'

export default async function AdminDashboard() {
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
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <AdminHeader 
            title="Admin Dashboard"
            description="Manage your hockey association membership system"
            useToggle={true}
          />

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
                  href="/admin/users"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Manage Users</div>
                  <div className="mt-1 text-gray-500">View and manage user accounts</div>
                </Link>

                <Link
                  href="/admin/discount-categories"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Discount System</div>
                  <div className="mt-1 text-sm text-gray-500">Manage categories and discount codes</div>
                </Link>

                <Link
                  href="/admin/reports"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium">Reports</div>
                  <div className="mt-1 text-sm text-gray-500">View system reports and analytics</div>
                </Link>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}