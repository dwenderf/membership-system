'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Registration {
  id: string
  name: string
  season_id: string | null
  season_name: string
  season_start_date: string | null
  season_end_date: string | null
  type: string
  start_date: string | null
  end_date: string | null
  total_count: number
  total_capacity: number | null
  total_waitlist_count: number
  category_breakdown: Array<{
    id: string
    name: string
    count: number
    waitlist_count: number
    max_capacity: number | null
    percentage_full: number | null
  }>
}

export default function RegistrationReportsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<string>('all')
  const [showPastEvents, setShowPastEvents] = useState(false)
  const router = useRouter()

  useEffect(() => {
    fetchRegistrations()
  }, [])

  const fetchRegistrations = async () => {
    try {
      setError(null)
      const response = await fetch('/api/admin/reports/registrations')
      if (!response.ok) {
        throw new Error('Failed to fetch registrations')
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

  const handleRegistrationClick = (registrationId: string) => {
    router.push(`/admin/reports/registrations/${registrationId}`)
  }

  // Helper function to check if a registration is currently active
  const isRegistrationActive = (registration: Registration): boolean => {
    // For events and scrimmages with dates set, use the event end_date
    if ((registration.type === 'event' || registration.type === 'scrimmage') && registration.end_date) {
      const eventEndDate = new Date(registration.end_date)
      return eventEndDate >= new Date()
    }

    // For teams or events/scrimmages without dates, use season end_date
    if (!registration.season_end_date) return false
    const seasonEndDate = new Date(registration.season_end_date)
    return seasonEndDate >= new Date()
  }

  // Get unique seasons for filter dropdown
  const seasons = Array.from(new Set(registrations.map(r => JSON.stringify({ id: r.season_id, name: r.season_name }))))
    .map(s => JSON.parse(s))
    .sort((a, b) => b.name.localeCompare(a.name))

  // Filter registrations based on selected season and show past events toggle
  const filteredRegistrations = registrations.filter(registration => {
    // Filter by season
    if (selectedSeason !== 'all' && registration.season_id !== selectedSeason) {
      return false
    }

    // Filter by active/past status
    if (!showPastEvents && !isRegistrationActive(registration)) {
      return false
    }

    return true
  })

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Registration Reports</h1>

      {/* Filtering Controls */}
      <div className="mb-6 bg-white shadow rounded-lg p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="season-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Filter by Season
            </label>
            <select
              id="season-filter"
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="all">All Seasons</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center mt-6">
            <input
              id="show-past-events"
              type="checkbox"
              checked={showPastEvents}
              onChange={(e) => setShowPastEvents(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="show-past-events" className="ml-2 block text-sm text-gray-900">
              Show past events/scrimmages
            </label>
          </div>

          <div className="flex-1 text-right text-sm text-gray-600 mt-6">
            Showing {filteredRegistrations.length} of {registrations.length} registrations
          </div>
        </div>
      </div>

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

      {/* Registration Tiles */}
      <div className="mb-8">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-100 rounded-lg p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
              </div>
            ))}
          </div>
        ) : filteredRegistrations.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-gray-500">No registrations found matching your filters.</p>
            {!showPastEvents && (
              <p className="text-sm text-gray-400 mt-2">
                Try enabling "Show past events/scrimmages" to see more results.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRegistrations.map((registration) => (
              <button
                key={registration.id}
                onClick={() => handleRegistrationClick(registration.id)}
                className="p-6 rounded-lg border-2 border-gray-200 bg-white transition-all duration-200 text-left hover:shadow-md hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    <span className="text-gray-600 font-semibold">Total Registrations</span>
                    <span className="font-bold text-gray-900">
                      {registration.total_count}
                    </span>
                  </div>
                </div>

                {/* Category breakdown */}
                {registration.category_breakdown.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Categories</p>
                    {registration.category_breakdown.slice(0, 3).map((category) => (
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
                        {/* Show waitlist count for this category */}
                        {category.waitlist_count > 0 && (
                          <div className="text-xs text-orange-600">
                            {category.waitlist_count} on waitlist
                          </div>
                        )}
                      </div>
                    ))}
                    {registration.category_breakdown.length > 3 && (
                      <p className="text-xs text-gray-500">+{registration.category_breakdown.length - 3} more categories</p>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
