'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface CaptainRegistration {
  id: string
  name: string
  type: string
  season_id: string | null
  season_name: string
  season_start_date: string | null
  season_end_date: string | null
  start_date: string | null
  end_date: string | null
  total_count: number
  category_breakdown: Array<{
    id: string
    name: string
    count: number
    max_capacity: number | null
  }>
  alternates_enabled: boolean
  alternates_count: number
}

export default function CaptainDashboardPage() {
  const [registrations, setRegistrations] = useState<CaptainRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPastTeams, setShowPastTeams] = useState(false)
  const router = useRouter()

  useEffect(() => {
    fetchRegistrations(showPastTeams)
  }, [showPastTeams])

  const fetchRegistrations = async (includePast: boolean) => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/user/captain/registrations?includePast=${includePast}`)

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('You must be logged in to view this page')
        }
        throw new Error('Failed to fetch your teams')
      }

      const result = await response.json()
      setRegistrations(result.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const getRegistrationTypeColor = (type: string) => {
    switch (type) {
      case 'team':
        return 'text-purple-600 bg-purple-100'
      case 'scrimmage':
        return 'text-orange-600 bg-orange-100'
      case 'event':
        return 'text-indigo-600 bg-indigo-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const isRegistrationActive = (registration: CaptainRegistration, today: string): boolean => {
    // For events and scrimmages with dates set, use the event end_date
    if ((registration.type === 'event' || registration.type === 'scrimmage') && registration.end_date) {
      // Extract date portion (YYYY-MM-DD) for comparison
      const eventEndDate = registration.end_date.split('T')[0]
      return eventEndDate >= today
    }

    // For teams or events/scrimmages without dates, use season end_date
    if (!registration.season_end_date) return false
    // Extract date portion (YYYY-MM-DD) for comparison
    const seasonEndDate = registration.season_end_date.split('T')[0]
    return seasonEndDate >= today
  }

  // Capture current date once for consistent evaluation
  const todayDateString = new Date().toISOString().split('T')[0]

  // Separate current and past teams
  const currentTeams = registrations.filter(r => isRegistrationActive(r, todayDateString))
  const pastTeams = registrations.filter(r => !isRegistrationActive(r, todayDateString))
  const hasPastTeams = pastTeams.length > 0
  const hasCurrentTeams = currentTeams.length > 0
  const hasNoTeams = registrations.length === 0 && !loading

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">My Teams</h1>

      {/* Show Past Teams Checkbox - only show if user has teams */}
      {!hasNoTeams && (
        <div className="mb-6">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showPastTeams}
              onChange={(e) => setShowPastTeams(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">Show past teams</span>
          </label>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-2 text-sm text-red-700">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-100 rounded-lg p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State - No teams at all */}
      {!loading && hasNoTeams && (
        <div className="bg-white rounded-lg border-2 border-gray-200 p-12 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            You're not assigned as a captain for any teams.
          </h2>
          <p className="text-gray-600 mb-6">
            If you believe this is an error, please contact your league administrator.
          </p>
          <Link
            href="/user"
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Return to Dashboard
          </Link>
        </div>
      )}

      {/* Empty State - No current teams but has past teams */}
      {!loading && !hasCurrentTeams && hasPastTeams && !showPastTeams && (
        <div className="bg-blue-50 rounded-lg border-2 border-blue-200 p-12 text-center">
          <div className="text-4xl mb-4">ℹ️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            You're not assigned as captain of any active teams.
          </h2>
          <p className="text-gray-600 mb-6">
            Click the "Show past teams" checkbox above to view teams from previous seasons.
          </p>
          <Link
            href="/user"
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Return to Dashboard
          </Link>
        </div>
      )}

      {/* Current/Future Teams */}
      {!loading && hasCurrentTeams && (
        <div className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentTeams.map((registration) => (
              <div
                key={registration.id}
                className="p-6 rounded-lg border-2 border-gray-200 bg-white hover:shadow-md hover:border-indigo-300 transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">{registration.name}</h3>
                    <p className="text-sm text-gray-600">{registration.season_name}</p>
                  </div>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRegistrationTypeColor(registration.type)}`}>
                    {registration.type}
                  </span>
                </div>

                {/* Total registration count */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 font-semibold">Registrations</span>
                    <span className="font-bold text-gray-900">
                      {registration.total_count}
                    </span>
                  </div>
                </div>

                {/* Category breakdown */}
                {registration.category_breakdown.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {registration.category_breakdown.map((category) => (
                      <div key={category.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 truncate flex-1">{category.name}</span>
                          <span className="font-medium text-gray-900 ml-2">
                            {category.count}
                            {category.max_capacity && ` / ${category.max_capacity}`}
                          </span>
                        </div>
                        {/* Only show progress bar for capacity-limited categories */}
                        {category.max_capacity && (
                          <div className="w-full bg-gray-200 rounded-full h-1">
                            <div
                              className="bg-indigo-600 h-1 rounded-full"
                              style={{
                                width: `${Math.min((category.count / category.max_capacity) * 100, 100)}%`
                              }}
                            ></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Alternates count */}
                {registration.alternates_enabled && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 font-semibold">Alternates</span>
                      <span className="font-bold text-gray-900">{registration.alternates_count}</span>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-4">
                  <Link
                    href={`/user/captain/${registration.id}/roster`}
                    className="flex-1 text-center px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    View Roster
                  </Link>
                  {registration.alternates_enabled && (
                    <Link
                      href={`/user/captain/${registration.id}/alternates`}
                      className="flex-1 text-center px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-md hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                    >
                      Manage Alternates
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past Teams */}
      {!loading && showPastTeams && hasPastTeams && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Past Teams</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pastTeams.map((registration) => (
              <div
                key={registration.id}
                className="p-6 rounded-lg border-2 border-gray-200 bg-gray-50 hover:shadow-md hover:border-gray-400 transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-700 mb-1">{registration.name}</h3>
                    <p className="text-sm text-gray-500">{registration.season_name}</p>
                  </div>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRegistrationTypeColor(registration.type)} opacity-75`}>
                    {registration.type}
                  </span>
                </div>

                {/* Total registration count */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 font-semibold">Registrations</span>
                    <span className="font-bold text-gray-700">
                      {registration.total_count}
                    </span>
                  </div>
                </div>

                {/* Category breakdown */}
                {registration.category_breakdown.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {registration.category_breakdown.map((category) => (
                      <div key={category.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500 truncate flex-1">{category.name}</span>
                          <span className="font-medium text-gray-700 ml-2">
                            {category.count}
                            {category.max_capacity && ` / ${category.max_capacity}`}
                          </span>
                        </div>
                        {/* Only show progress bar for capacity-limited categories */}
                        {category.max_capacity && (
                          <div className="w-full bg-gray-300 rounded-full h-1">
                            <div
                              className="bg-gray-600 h-1 rounded-full"
                              style={{
                                width: `${Math.min((category.count / category.max_capacity) * 100, 100)}%`
                              }}
                            ></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Alternates count */}
                {registration.alternates_enabled && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 font-semibold">Alternates</span>
                      <span className="font-bold text-gray-700">{registration.alternates_count}</span>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-4">
                  <Link
                    href={`/user/captain/${registration.id}/roster`}
                    className="flex-1 text-center px-3 py-2 text-sm font-medium text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                  >
                    View Roster
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
