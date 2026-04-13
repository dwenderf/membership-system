'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import FinancialSummary from '@/components/FinancialSummary'

interface FinancialSummaryData {
  roster_gross: number
  roster_discounts: number
  roster_net: number
  alt_gross: number
  alt_discounts: number
  alt_net: number
  total_net: number
}

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
  alternates_count: number
  alternates_enabled: boolean
  category_breakdown: Array<{
    id: string
    name: string
    count: number
    waitlist_count: number
    max_capacity: number | null
    percentage_full: number | null
  }>
  captains?: Array<{
    first_name: string
    last_name: string
  }>
  financial_summary?: FinancialSummaryData
}

type SortOption = 'name-asc' | 'name-desc' | 'season' | 'date'

function getRegistrationTypeColor(type: string) {
  switch (type) {
    case 'team': return 'text-purple-600 bg-purple-100'
    case 'scrimmage': return 'text-orange-600 bg-orange-100'
    case 'event': return 'text-indigo-600 bg-indigo-100'
    default: return 'text-gray-600 bg-gray-100'
  }
}

function isRegistrationActive(registration: Registration, today: string): boolean {
  if ((registration.type === 'event' || registration.type === 'scrimmage') && registration.end_date) {
    return registration.end_date.split('T')[0] >= today
  }
  if (!registration.season_end_date) return false
  return registration.season_end_date.split('T')[0] >= today
}

function sortRegistrations(list: Registration[], sort: SortOption): Registration[] {
  return [...list].sort((a, b) => {
    switch (sort) {
      case 'name-asc': return a.name.localeCompare(b.name)
      case 'name-desc': return b.name.localeCompare(a.name)
      case 'season': {
        const seasonCmp = (b.season_name || '').localeCompare(a.season_name || '')
        if (seasonCmp !== 0) return seasonCmp
        return a.name.localeCompare(b.name)
      }
      case 'date': {
        const aDate = a.start_date || a.season_start_date || ''
        const bDate = b.start_date || b.season_start_date || ''
        if (bDate !== aDate) return bDate.localeCompare(aDate)
        return a.name.localeCompare(b.name)
      }
    }
  })
}

export default function RegistrationReportsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<string>('all')
  const [showPastEvents, setShowPastEvents] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>('name-asc')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchRegistrations()
  }, [])

  const fetchRegistrations = async () => {
    try {
      setError(null)
      const response = await fetch('/api/admin/reports/registrations')
      if (!response.ok) throw new Error('Failed to fetch registrations')
      const result = await response.json()
      setRegistrations(result.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const todayDateString = new Date().toISOString().split('T')[0]

  const seasons = Array.from(new Set(registrations.map(r => JSON.stringify({ id: r.season_id, name: r.season_name }))))
    .map(s => JSON.parse(s))
    .sort((a, b) => b.name.localeCompare(a.name))

  const filteredRegistrations = sortRegistrations(
    registrations.filter(r => {
      if (selectedSeason !== 'all' && r.season_id !== selectedSeason) return false
      if (!showPastEvents && !isRegistrationActive(r, todayDateString)) return false
      return true
    }),
    sortBy
  )

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Registration Reports</h1>

      {/* Controls */}
      <div className="mb-6 bg-white shadow rounded-lg p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="season-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Filter by Season
            </label>
            <select
              id="season-filter"
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              <option value="all">All Seasons</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>{season.name}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label htmlFor="sort-by" className="block text-sm font-medium text-gray-700 mb-1">
              Sort by
            </label>
            <select
              id="sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="season">Season</option>
              <option value="date">Date</option>
            </select>
          </div>

          <div className="flex items-center pb-0.5">
            <input
              id="show-past-events"
              type="checkbox"
              checked={showPastEvents}
              onChange={(e) => setShowPastEvents(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="show-past-events" className="ml-2 text-sm text-gray-900">
              Show past events/scrimmages
            </label>
          </div>

          <div className="ml-auto text-sm text-gray-500 pb-0.5">
            {filteredRegistrations.length} of {registrations.length} registrations
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <p className="mt-1 text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-14 animate-pulse" />
          ))}
        </div>
      ) : filteredRegistrations.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-500">No registrations found matching your filters.</p>
          {!showPastEvents && (
            <p className="text-sm text-gray-400 mt-2">Try enabling "Show past events/scrimmages" to see more results.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRegistrations.map((registration) => {
            const isExpanded = expandedIds.has(registration.id)
            return (
              <div
                key={registration.id}
                className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* Collapsed row — click to expand */}
                <button
                  onClick={() => toggleExpanded(registration.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                >
                  {/* Chevron */}
                  <svg
                    className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>

                  {/* Name */}
                  <span className="flex-1 font-semibold text-gray-900 text-sm">{registration.name}</span>

                  {/* Season */}
                  <span className="hidden sm:inline text-xs text-gray-500 mr-2">{registration.season_name}</span>

                  {/* Member count */}
                  <span className="text-sm font-medium text-gray-600 whitespace-nowrap">
                    {registration.total_count} members
                  </span>

                  {/* Net revenue */}
                  {registration.financial_summary && (
                    <span className="ml-3 text-sm font-semibold text-green-700 whitespace-nowrap">
                      ${Math.round(registration.financial_summary.total_net / 100).toLocaleString('en-US')} net
                    </span>
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-200 px-5 py-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                      {/* Left column */}
                      <div>
                        {/* Season (mobile) */}
                        <p className="text-sm text-gray-500 mb-4 sm:hidden">{registration.season_name}</p>

                        {/* Category breakdown */}
                        {registration.category_breakdown.length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Categories</h4>
                            <div className="space-y-2">
                              {registration.category_breakdown.map((category) => (
                                <div key={category.id} className="space-y-1">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-700 truncate flex-1">{category.name}</span>
                                    <span className="font-medium text-gray-900 ml-2">
                                      {category.count}
                                      {category.max_capacity && ` / ${category.max_capacity}`}
                                    </span>
                                  </div>
                                  {category.max_capacity && (
                                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                                      <div
                                        className="bg-indigo-500 h-1.5 rounded-full"
                                        style={{ width: `${Math.min((category.count / category.max_capacity) * 100, 100)}%` }}
                                      />
                                    </div>
                                  )}
                                  {category.waitlist_count > 0 && (
                                    <p className="text-xs text-orange-600">{category.waitlist_count} on waitlist</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Captains */}
                        {registration.captains && registration.captains.length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Captains</h4>
                            <div className="text-sm text-gray-700 space-y-0.5">
                              {registration.captains.map((captain, idx) => (
                                <div key={idx}>{captain.first_name} {captain.last_name}</div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Alternates */}
                        {registration.alternates_enabled && (
                          <div className="mb-4">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Alternates</h4>
                            <p className="text-sm font-medium text-gray-900">{registration.alternates_count}</p>
                          </div>
                        )}
                      </div>

                      {/* Right column — financial */}
                      {registration.financial_summary && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Financial</h4>
                          <FinancialSummary
                            data={registration.financial_summary}
                            mode="compact"
                            showAlternates={registration.alternates_enabled}
                          />
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="mt-4 pt-4 border-t border-gray-100 flex gap-3">
                      <Link
                        href={`/admin/reports/registrations/${registration.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        View Roster
                      </Link>
                      {registration.alternates_enabled && (
                        <Link
                          href={`/admin/reports/registrations/${registration.id}?tab=alternates`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-md hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          Manage Alternates
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
