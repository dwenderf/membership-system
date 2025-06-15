import { createClient } from '@/lib/supabase/server'
import { formatDateString } from '@/lib/date-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function RegistrationsPage() {
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

  // Get all registrations with their associated season info
  const { data: registrations, error } = await supabase
    .from('registrations')
    .select(`
      *,
      seasons (
        id,
        name,
        type,
        start_date,
        end_date
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching registrations:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Registration Management</h1>
              <p className="mt-1 text-sm text-gray-600">
                Create and manage team registrations and events
              </p>
            </div>
            <Link
              href="/admin/registrations/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Registration
            </Link>
          </div>

          {/* Registrations List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            {!registrations || registrations.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">No registrations created yet</div>
                <Link
                  href="/admin/registrations/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Create Your First Registration
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {registrations.map((registration: any) => {
                  const season = registration.seasons
                  const isSeasonEnded = season && new Date(season.end_date) < new Date()
                  
                  return (
                    <li key={registration.id}>
                      <div className="px-4 py-4 flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center">
                              <Link
                                href={`/admin/registrations/${registration.id}`}
                                className="text-lg font-medium text-gray-900 hover:text-blue-600 truncate"
                              >
                                {registration.name}
                              </Link>
                              <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                                registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
                                registration.type === 'scrimmage' ? 'bg-green-100 text-green-800' :
                                'bg-purple-100 text-purple-800'
                              }`}>
                                {registration.type}
                              </span>
                              {isSeasonEnded ? (
                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                  Season Ended
                                </span>
                              ) : (
                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center text-sm text-gray-500">
                              <span>{season?.name || 'No season'}</span>
                              {!registration.allow_discounts && (
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
                            Created {new Date(registration.created_at).toLocaleDateString()}
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