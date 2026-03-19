'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getLgbtqStatusLabel, getLgbtqStatusStyles, getGoalieStatusLabel, getGoalieStatusStyles, getCategoryPillStyles } from '@/lib/user-attributes'
import UserLink from '@/components/UserLink'
import { formatDate as formatDateUtil, formatTime as formatTimeUtil } from '@/lib/date-utils'

interface RegistrationData {
  id: string
  registration_id: string
  registration_name: string
  season_name: string
  registration_type: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  member_id: number | null
  category_name: string
  category_id: string
  payment_status: string
  amount_paid: number
  payment_id: string | null
  registered_at: string
  is_lgbtq: boolean | null
  is_goalie: boolean
}

interface WaitlistData {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  category_name: string
  category_id: string
  position: number
  joined_at: string
  is_lgbtq: boolean | null
  is_goalie: boolean
}

interface AlternateData {
  user_id: string
  first_name: string
  last_name: string
  email: string
  is_lgbtq: boolean | null
  is_goalie: boolean
  times_played: number
  total_paid: number
  registered_at: string
  selections: Array<{
    game_description: string
    game_date: string
    amount_charged: number
    selected_at: string
  }>
}

type LgbtqFilter = 'lgbtq' | 'ally' | 'no_response'
type GoalieFilter = 'goalie' | 'non_goalie'

export default function CaptainRosterPage() {
  const params = useParams()
  const registrationId = params.id as string

  const [registrationData, setRegistrationData] = useState<RegistrationData[]>([])
  const [waitlistData, setWaitlistData] = useState<WaitlistData[]>([])
  const [alternatesData, setAlternatesData] = useState<AlternateData[]>([])
  const [registrationName, setRegistrationName] = useState('')
  const [seasonName, setSeasonName] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof RegistrationData>('first_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [alternatesSortField, setAlternatesSortField] = useState<keyof AlternateData>('first_name')
  const [alternatesSortDirection, setAlternatesSortDirection] = useState<'asc' | 'desc'>('asc')

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [lgbtqFilter, setLgbtqFilter] = useState<LgbtqFilter | null>(null)
  const [goalieFilter, setGoalieFilter] = useState<GoalieFilter | null>(null)

  useEffect(() => {
    if (registrationId) {
      fetchRosterData(registrationId)
    }
  }, [registrationId])

  const fetchRosterData = async (id: string) => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/user/captain/${id}/roster`)

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('You are not a captain of this registration')
        }
        throw new Error('Failed to fetch roster data')
      }

      const result = await response.json()
      setRegistrationData(result.data || [])
      setWaitlistData(result.waitlistData || [])
      setAlternatesData(result.alternatesData || [])
      setIsAdmin(result.isAdmin || false)

      // Set title information from first registration record
      if (result.data && result.data.length > 0) {
        setRegistrationName(result.data[0].registration_name)
        setSeasonName(result.data[0].season_name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => `$${(amount / 100).toFixed(2)}`

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return {
      date: formatDateUtil(date),
      time: formatTimeUtil(date),
    }
  }

  const handleSort = (field: keyof RegistrationData) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleAlternatesSort = (field: keyof AlternateData) => {
    if (alternatesSortField === field) {
      setAlternatesSortDirection(alternatesSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setAlternatesSortField(field)
      setAlternatesSortDirection('asc')
    }
  }

  // Only paid members belong on the active roster
  const allActiveMembers = registrationData.filter(r => r.payment_status === 'paid')
  const refundedMembers = registrationData.filter(r => r.payment_status === 'refunded')

  // Unique categories with counts (from all active members)
  const categoryCountsMap = new Map<string, number>()
  allActiveMembers.forEach(m => {
    categoryCountsMap.set(m.category_name, (categoryCountsMap.get(m.category_name) || 0) + 1)
  })
  const categoryCounts = Array.from(categoryCountsMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // LGBTQ counts
  const lgbtqCounts = {
    lgbtq: allActiveMembers.filter(m => m.is_lgbtq === true).length,
    ally: allActiveMembers.filter(m => m.is_lgbtq === false).length,
    no_response: allActiveMembers.filter(m => m.is_lgbtq === null).length,
  }

  // Goalie counts
  const goalieCounts = {
    goalie: allActiveMembers.filter(m => m.is_goalie === true).length,
    non_goalie: allActiveMembers.filter(m => m.is_goalie === false).length,
  }

  // Apply search + dimension filters to active members
  const filteredActiveMembers = allActiveMembers.filter(member => {
    const fullName = `${member.first_name} ${member.last_name}`.toLowerCase()
    const email = member.email?.toLowerCase() || ''
    const search = searchTerm.toLowerCase()
    if (!fullName.includes(search) && !email.includes(search)) return false

    if (categoryFilter && member.category_name !== categoryFilter) return false

    if (lgbtqFilter === 'lgbtq' && member.is_lgbtq !== true) return false
    if (lgbtqFilter === 'ally' && member.is_lgbtq !== false) return false
    if (lgbtqFilter === 'no_response' && member.is_lgbtq !== null) return false

    if (goalieFilter === 'goalie' && member.is_goalie !== true) return false
    if (goalieFilter === 'non_goalie' && member.is_goalie !== false) return false

    return true
  })

  // Sort filtered active members
  const sortedMembers = [...filteredActiveMembers].sort((a, b) => {
    let aValue: string | number | boolean | null = a[sortField]
    let bValue: string | number | boolean | null = b[sortField]

    if (sortField === 'is_lgbtq') {
      aValue = getLgbtqStatusLabel(a.is_lgbtq)
      bValue = getLgbtqStatusLabel(b.is_lgbtq)
    } else if (sortField === 'is_goalie') {
      aValue = getGoalieStatusLabel(a.is_goalie)
      bValue = getGoalieStatusLabel(b.is_goalie)
    }

    if (sortField === 'amount_paid') {
      const aNum = typeof aValue === 'number' ? aValue : 0
      const bNum = typeof bValue === 'number' ? bValue : 0
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue
    }

    return 0
  })

  const hasActiveFilters = categoryFilter !== null || lgbtqFilter !== null || goalieFilter !== null

  const toggleCategoryFilter = (name: string) =>
    setCategoryFilter(prev => (prev === name ? null : name))
  const toggleLgbtqFilter = (value: LgbtqFilter) =>
    setLgbtqFilter(prev => (prev === value ? null : value))
  const toggleGoalieFilter = (value: GoalieFilter) =>
    setGoalieFilter(prev => (prev === value ? null : value))

  const sortIndicator = (field: keyof RegistrationData) =>
    sortField === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Navigation - Top */}
      <div className="mb-4">
        <Link
          href="/user/captain"
          className="text-blue-600 hover:text-blue-500 text-sm font-medium"
        >
          ← Back to My Teams
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{registrationName}</h1>
        <p className="text-lg text-gray-600">{seasonName}</p>
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

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-2 text-gray-600">Loading roster...</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary & Filters */}
          <div className="mb-6 bg-white shadow rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Roster Summary</h2>
              {hasActiveFilters && (
                <button
                  onClick={() => { setCategoryFilter(null); setLgbtqFilter(null); setGoalieFilter(null) }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Category */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider w-20 shrink-0">Category</span>
              <div className="flex flex-wrap gap-2">
                {categoryCounts.map(({ name, count }) => (
                  <button
                    key={name}
                    onClick={() => toggleCategoryFilter(name)}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      categoryFilter === name
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100'
                    }`}
                  >
                    {name}
                    <span className={`font-normal ${categoryFilter === name ? 'opacity-80' : 'opacity-60'}`}>({count})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* LGBTQ */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider w-20 shrink-0">LGBTQ+</span>
              <div className="flex flex-wrap gap-2">
                {lgbtqCounts.lgbtq > 0 && (
                  <button
                    onClick={() => toggleLgbtqFilter('lgbtq')}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      lgbtqFilter === 'lgbtq'
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100'
                    }`}
                  >
                    LGBTQ+
                    <span className={`font-normal ${lgbtqFilter === 'lgbtq' ? 'opacity-80' : 'opacity-60'}`}>({lgbtqCounts.lgbtq})</span>
                  </button>
                )}
                {lgbtqCounts.ally > 0 && (
                  <button
                    onClick={() => toggleLgbtqFilter('ally')}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      lgbtqFilter === 'ally'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                    }`}
                  >
                    Ally
                    <span className={`font-normal ${lgbtqFilter === 'ally' ? 'opacity-80' : 'opacity-60'}`}>({lgbtqCounts.ally})</span>
                  </button>
                )}
                {lgbtqCounts.no_response > 0 && (
                  <button
                    onClick={() => toggleLgbtqFilter('no_response')}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      lgbtqFilter === 'no_response'
                        ? 'bg-gray-500 text-white border-gray-500'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    No Response
                    <span className={`font-normal ${lgbtqFilter === 'no_response' ? 'opacity-80' : 'opacity-60'}`}>({lgbtqCounts.no_response})</span>
                  </button>
                )}
              </div>
            </div>

            {/* Goalie */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider w-20 shrink-0">Goalie</span>
              <div className="flex flex-wrap gap-2">
                {goalieCounts.goalie > 0 && (
                  <button
                    onClick={() => toggleGoalieFilter('goalie')}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      goalieFilter === 'goalie'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100'
                    }`}
                  >
                    Goalie
                    <span className={`font-normal ${goalieFilter === 'goalie' ? 'opacity-80' : 'opacity-60'}`}>({goalieCounts.goalie})</span>
                  </button>
                )}
                <button
                  onClick={() => toggleGoalieFilter('non_goalie')}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    goalieFilter === 'non_goalie'
                      ? 'bg-gray-500 text-white border-gray-500'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  Non-Goalie
                  <span className={`font-normal ${goalieFilter === 'non_goalie' ? 'opacity-80' : 'opacity-60'}`}>({goalieCounts.non_goalie})</span>
                </button>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Roster Table */}
          <div className="bg-white shadow rounded-lg overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Roster{' '}
                {hasActiveFilters || searchTerm
                  ? `(${sortedMembers.length} of ${allActiveMembers.length} active members)`
                  : `(${allActiveMembers.length} active members)`}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('first_name')}
                    >
                      Name{sortIndicator('first_name')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('category_name')}
                    >
                      Category{sortIndicator('category_name')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('is_lgbtq')}
                    >
                      LGBTQ+{sortIndicator('is_lgbtq')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('is_goalie')}
                    >
                      Goalie{sortIndicator('is_goalie')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('amount_paid')}
                    >
                      Amount Paid{sortIndicator('amount_paid')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('registered_at')}
                    >
                      Registered{sortIndicator('registered_at')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">
                        <UserLink
                          userId={member.user_id}
                          firstName={member.first_name}
                          lastName={member.last_name}
                          email={member.email}
                          showMembershipNumber={false}
                          showEmail={true}
                          disableLink={!isAdmin}
                          fromPath={`/user/captain/${registrationId}/roster`}
                          fromLabel={registrationName || 'Captain Roster'}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getCategoryPillStyles()}`}>
                          {member.category_name}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getLgbtqStatusStyles(member.is_lgbtq)}`}>
                          {getLgbtqStatusLabel(member.is_lgbtq)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getGoalieStatusStyles(member.is_goalie)}`}>
                          {getGoalieStatusLabel(member.is_goalie)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {formatCurrency(member.amount_paid)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div>{formatDateTime(member.registered_at).date}</div>
                          {formatDateTime(member.registered_at).time && (
                            <div className="text-xs text-gray-500">{formatDateTime(member.registered_at).time}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedMembers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                        No members match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Refunded Members Section */}
            {refundedMembers.length > 0 && (
              <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Refunded Members ({refundedMembers.length})</h3>
                <div className="space-y-2">
                  {refundedMembers.map((member) => (
                    <div key={member.id} className="text-sm text-gray-500 opacity-60">
                      <span className="line-through">{member.first_name} {member.last_name}</span>
                      <span className="ml-2">({member.email})</span>
                      <span className="ml-2">{member.category_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Waitlist */}
          {waitlistData.length > 0 && (
            <div className="bg-white shadow rounded-lg overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Waitlist ({waitlistData.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Position
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        LGBTQ+
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Goalie
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {waitlistData.map((waitlist) => (
                      <tr key={waitlist.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {waitlist.position}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <UserLink
                            userId={waitlist.user_id}
                            firstName={waitlist.first_name}
                            lastName={waitlist.last_name}
                            email={waitlist.email}
                            showMembershipNumber={false}
                            showEmail={true}
                            disableLink={!isAdmin}
                            fromPath={`/user/captain/${registrationId}/roster`}
                            fromLabel={registrationName || 'Captain Roster'}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getCategoryPillStyles()}`}>
                            {waitlist.category_name}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getLgbtqStatusStyles(waitlist.is_lgbtq)}`}>
                            {getLgbtqStatusLabel(waitlist.is_lgbtq)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getGoalieStatusStyles(waitlist.is_goalie)}`}>
                            {getGoalieStatusLabel(waitlist.is_goalie)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Alternates */}
          {alternatesData.length > 0 && (() => {
            // Filter alternates data by search term
            const filteredAlternatesData = alternatesData.filter(alternate => {
              const fullName = `${alternate.first_name} ${alternate.last_name}`.toLowerCase()
              const email = alternate.email.toLowerCase()
              const search = searchTerm.toLowerCase()
              return fullName.includes(search) || email.includes(search)
            })

            // Sort alternates data
            const sortedAlternatesData = [...filteredAlternatesData].sort((a, b) => {
              let aValue: string | number | boolean | null = a[alternatesSortField]
              let bValue: string | number | boolean | null = b[alternatesSortField]

              if (alternatesSortField === 'is_lgbtq') {
                aValue = getLgbtqStatusLabel(a.is_lgbtq)
                bValue = getLgbtqStatusLabel(b.is_lgbtq)
              } else if (alternatesSortField === 'is_goalie') {
                aValue = getGoalieStatusLabel(a.is_goalie)
                bValue = getGoalieStatusLabel(b.is_goalie)
              }

              if (alternatesSortField === 'times_played' || alternatesSortField === 'total_paid') {
                const aNum = typeof aValue === 'number' ? aValue : 0
                const bNum = typeof bValue === 'number' ? bValue : 0
                return alternatesSortDirection === 'asc' ? aNum - bNum : bNum - aNum
              }

              if (alternatesSortField === 'registered_at') {
                return alternatesSortDirection === 'asc'
                  ? new Date(a.registered_at).getTime() - new Date(b.registered_at).getTime()
                  : new Date(b.registered_at).getTime() - new Date(a.registered_at).getTime()
              }

              if (typeof aValue === 'string' && typeof bValue === 'string') {
                return alternatesSortDirection === 'asc'
                  ? aValue.localeCompare(bValue)
                  : bValue.localeCompare(aValue)
              }

              return 0
            })

            return (
              <div className="bg-white shadow rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Alternates ({filteredAlternatesData.length}{filteredAlternatesData.length !== alternatesData.length ? ` of ${alternatesData.length}` : ''})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {[
                          { key: 'first_name', label: 'Name' },
                          { key: 'is_lgbtq', label: 'LGBTQ+' },
                          { key: 'is_goalie', label: 'Goalie' },
                          { key: 'times_played', label: 'Times Played' },
                          { key: 'total_paid', label: 'Total Paid' },
                          { key: 'registered_at', label: 'Registered' },
                        ].map(({ key, label }) => (
                          <th
                            key={key}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => handleAlternatesSort(key as keyof AlternateData)}
                          >
                            <div className="flex items-center">
                              {label}
                              {alternatesSortField === key && (
                                <span className="ml-1">
                                  {alternatesSortDirection === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedAlternatesData.map((alternate) => (
                        <tr key={alternate.user_id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm">
                            <UserLink
                              userId={alternate.user_id}
                              firstName={alternate.first_name}
                              lastName={alternate.last_name}
                              email={alternate.email}
                              showMembershipNumber={false}
                              showEmail={true}
                              disableLink={!isAdmin}
                              fromPath={`/user/captain/${registrationId}/roster`}
                              fromLabel={registrationName || 'Captain Roster'}
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getLgbtqStatusStyles(alternate.is_lgbtq)}`}>
                              {getLgbtqStatusLabel(alternate.is_lgbtq)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getGoalieStatusStyles(alternate.is_goalie)}`}>
                              {getGoalieStatusLabel(alternate.is_goalie)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                            {alternate.times_played}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                            {formatCurrency(alternate.total_paid)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {alternate.registered_at ? (
                              <div>
                                <div>{formatDateTime(alternate.registered_at).date}</div>
                                {formatDateTime(alternate.registered_at).time && (
                                  <div className="text-xs text-gray-500">{formatDateTime(alternate.registered_at).time}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* Navigation - Bottom */}
          <div className="mt-8">
            <Link
              href="/user/captain"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to My Teams
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
