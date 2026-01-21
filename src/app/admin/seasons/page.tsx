import { createClient } from '@/lib/supabase/server'
import { formatDateString, formatDate } from '@/lib/date-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function SeasonsPage() {
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

  // Get all seasons, sorted by start date descending (newest first)
  const { data: seasons, error } = await supabase
    .from('seasons')
    .select('*')
    .order('start_date', { ascending: false })

  if (error) {
    console.error('Error fetching seasons:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Navigation - Top */}
          <div className="mb-4">
            <Link
              href="/admin"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Admin Dashboard
            </Link>
          </div>

          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Season Management</h1>
              <p className="mt-1 text-sm text-gray-600">
                Create and manage hockey seasons
              </p>
            </div>
            <Link
              href="/admin/seasons/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Season
            </Link>
          </div>

          {/* Seasons List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            {!seasons || seasons.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">No seasons created yet</div>
                <Link
                  href="/admin/seasons/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Create Your First Season
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {seasons.map((season) => (
                  <li key={season.id}>
                    <div className="px-4 py-4 flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center">
                            <p className="text-lg font-medium text-gray-900 truncate">
                              {season.name}
                            </p>
                            {(() => {
                              const now = new Date()
                              const endDate = new Date(season.end_date)
                              const isEnded = endDate < now
                              
                              if (isEnded) {
                                return (
                                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                    Ended
                                  </span>
                                )
                              } else if (season.is_active) {
                                return (
                                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Active
                                  </span>
                                )
                              }
                              return null
                            })()}
                          </div>
                          <div className="mt-1 flex items-center text-sm text-gray-500">
                            <span className="capitalize">{season.type.replace('_', '/')}</span>
                            <span className="mx-2">•</span>
                            <span>
                              {formatDateString(season.start_date)} - {formatDateString(season.end_date)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-400">
                          Created {formatDate(new Date(season.created_at))}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Navigation - Bottom */}
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