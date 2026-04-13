'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getLgbtqStatusLabel, getLgbtqStatusStyles, getGoalieStatusLabel, getGoalieStatusStyles, getCategoryPillStyles } from '@/lib/user-attributes'
import WaitlistSelectionModal from '@/components/WaitlistSelectionModal'
import UserLink from '@/components/UserLink'
import { formatDate as formatDateUtil, formatTime as formatTimeUtil } from '@/lib/date-utils'
import { buildBreadcrumbUrl } from '@/lib/breadcrumb-utils'
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
  member_id: number | null
  category_name: string
  category_id: string
  registration_category_name: string
  payment_status: string
  amount_paid: number
  registered_at: string
  registration_fee: number
  presale_code_used: string | null
  is_lgbtq: boolean | null
  is_goalie: boolean
  payment_id: string | null
  invoice_number: string | null
  discount_code: string | null
  discount_amount_saved: number
}

interface WaitlistData {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  category_name: string
  category_id: string
  position: number
  joined_at: string
  is_lgbtq: boolean | null
  is_goalie: boolean
  hasValidPaymentMethod: boolean
  discount_code_id: string | null
  discount_code: string | null
  discount_percentage: number | null
  base_price: number
  discount_amount: number
  final_amount: number
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

export default function RegistrationDetailPage() {
  const params = useParams()
  const registrationId = params.id as string

  const [registrationData, setRegistrationData] = useState<RegistrationData[]>([])
  const [waitlistData, setWaitlistData] = useState<WaitlistData[]>([])
  const [alternatesData, setAlternatesData] = useState<AlternateData[]>([])
  const [financialSummary, setFinancialSummary] = useState<FinancialSummaryData | null>(null)
  const [registrationName, setRegistrationName] = useState('')
  const [seasonName, setSeasonName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof RegistrationData>('first_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [waitlistSortField, setWaitlistSortField] = useState<keyof WaitlistData>('position')
  const [waitlistSortDirection, setWaitlistSortDirection] = useState<'asc' | 'desc'>('asc')
  const [alternatesSortField, setAlternatesSortField] = useState<keyof AlternateData>('first_name')
  const [alternatesSortDirection, setAlternatesSortDirection] = useState<'asc' | 'desc'>('asc')
  const [selectedWaitlistEntry, setSelectedWaitlistEntry] = useState<WaitlistData | null>(null)
  const [showWaitlistSelectionModal, setShowWaitlistSelectionModal] = useState(false)

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [lgbtqFilter, setLgbtqFilter] = useState<LgbtqFilter | null>(null)
  const [goalieFilter, setGoalieFilter] = useState<GoalieFilter | null>(null)

  useEffect(() => {
    if (registrationId) {
      fetchRegistrationData(registrationId)
    }
  }, [registrationId])

  const fetchRegistrationData = async (id: string) => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/admin/reports/registrations?registrationId=${id}`)
      if (!response.ok) {
        throw new Error('Failed to fetch registration data')
      }
      const result = await response.json()
      setRegistrationData(result.data || [])
      setWaitlistData(result.waitlistData || [])
      setAlternatesData(result.alternatesData || [])
      setFinancialSummary(result.financialSummary || null)

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

  const formatDateTime = (dateString: string | null | undefined) => {
    if (!dateString) return { date: 'N/A', time: '' }
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return { date: 'N/A', time: '' }
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

  const handleWaitlistSort = (field: keyof WaitlistData) => {
    if (waitlistSortField === field) {
      setWaitlistSortDirection(waitlistSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setWaitlistSortField(field)
      setWaitlistSortDirection('asc')
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

  // Split by payment status — only paid records belong on the active roster
  const allActiveMembers = registrationData.filter(r => r.payment_status === 'paid')
  const refundedMembers = registrationData.filter(r => r.payment_status === 'refunded')

  // Category counts (from all active members, for filter chips)
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

  // Apply search + filters to active members
  const filteredActiveMembers = allActiveMembers.filter(member => {
    const fullName = `${member.first_name} ${member.last_name}`.toLowerCase()
    const email = member.email?.toLowerCase() || ''
    const category = member.category_name?.toLowerCase() || ''
    const search = searchTerm.toLowerCase()
    if (!fullName.includes(search) && !email.includes(search) && !category.includes(search)) return false

    if (categoryFilter && member.category_name !== categoryFilter) return false

    if (lgbtqFilter === 'lgbtq' && member.is_lgbtq !== true) return false
    if (lgbtqFilter === 'ally' && member.is_lgbtq !== false) return false
    if (lgbtqFilter === 'no_response' && member.is_lgbtq !== null) return false

    if (goalieFilter === 'goalie' && member.is_goalie !== true) return false
    if (goalieFilter === 'non_goalie' && member.is_goalie !== false) return false

    return true
  })

  // Sort active members
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

    if (sortField === 'amount_paid' || sortField === 'registration_fee') {
      const aNum = typeof aValue === 'number' ? aValue : 0
      const bNum = typeof bValue === 'number' ? bValue : 0
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
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

  const waitlistSortIndicator = (field: keyof WaitlistData) =>
    waitlistSortField === field ? (waitlistSortDirection === 'asc' ? ' ↑' : ' ↓') : ''

  // Filter and sort waitlist
  const filteredWaitlistData = waitlistData.filter(w => {
    const fullName = `${w.first_name} ${w.last_name}`.toLowerCase()
    const email = w.email.toLowerCase()
    const category = w.category_name.toLowerCase()
    const search = searchTerm.toLowerCase()
    return fullName.includes(search) || email.includes(search) || category.includes(search)
  })

  const sortedWaitlistData = [...filteredWaitlistData].sort((a, b) => {
    let aValue = a[waitlistSortField]
    let bValue = b[waitlistSortField]

    if (waitlistSortField === 'is_lgbtq') {
      aValue = getLgbtqStatusLabel(a.is_lgbtq)
      bValue = getLgbtqStatusLabel(b.is_lgbtq)
    } else if (waitlistSortField === 'is_goalie') {
      aValue = getGoalieStatusLabel(a.is_goalie)
      bValue = getGoalieStatusLabel(b.is_goalie)
    }

    if (waitlistSortField === 'joined_at') {
      return waitlistSortDirection === 'asc'
        ? new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
        : new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime()
    }

    if (waitlistSortField === 'position') {
      const aNum = typeof aValue === 'number' ? aValue : 0
      const bNum = typeof bValue === 'number' ? bValue : 0
      return waitlistSortDirection === 'asc' ? aNum - bNum : bNum - aNum
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return waitlistSortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
    }

    return 0
  })

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Navigation - Top */}
      <div className="mb-4">
        <Link
          href="/admin/reports/registrations"
          className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-800"
        >
          <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          Return to Registrations
        </Link>
      </div>

      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{registrationName}</h1>
        <p className="mt-2 text-lg text-gray-600">{seasonName}</p>
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
          <p className="mt-2 text-gray-600">Loading registration data...</p>
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

          {/* Financial Summary */}
          {financialSummary && (
            <FinancialSummary
              data={financialSummary}
              mode="full"
              showAlternates={alternatesData.length > 0}
            />
          )}

          {/* Search */}
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search by name, email, or category..."
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
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Discount
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
                  {sortedMembers.map((registration, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">
                        <UserLink
                          userId={registration.user_id}
                          firstName={registration.first_name}
                          lastName={registration.last_name}
                          email={registration.email}
                          membershipNumber={registration.member_id}
                          showMembershipNumber={true}
                          showEmail={true}
                          fromPath={`/admin/reports/registrations/${registrationId}`}
                          fromLabel={registrationName || 'Registration Detail'}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getCategoryPillStyles()}`}>
                          {registration.category_name}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getLgbtqStatusStyles(registration.is_lgbtq)}`}>
                          {getLgbtqStatusLabel(registration.is_lgbtq)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getGoalieStatusStyles(registration.is_goalie)}`}>
                          {getGoalieStatusLabel(registration.is_goalie)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">
                        {registration.payment_id ? (
                          <Link
                            href={buildBreadcrumbUrl(
                              `/admin/reports/users/${registration.user_id}/invoices/${registration.payment_id}`,
                              [],
                              { path: `/admin/reports/registrations/${registrationId}`, label: registrationName || 'Registration Detail' }
                            )}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline"
                          >
                            {formatCurrency(registration.amount_paid)}
                          </Link>
                        ) : (
                          <span className="text-gray-900">{formatCurrency(registration.amount_paid)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {registration.discount_code ? (
                          <div>
                            <span className="font-medium text-gray-900">{registration.discount_code}</span>
                            {registration.discount_amount_saved > 0 && (
                              <div className="text-xs text-red-600">-{formatCurrency(registration.discount_amount_saved)}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div>{formatDateTime(registration.registered_at).date}</div>
                          {formatDateTime(registration.registered_at).time && (
                            <div className="text-xs text-gray-500">{formatDateTime(registration.registered_at).time}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedMembers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
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
                    <div key={member.id} className="flex items-center gap-3 text-sm opacity-60">
                      <UserLink
                        userId={member.user_id}
                        firstName={member.first_name}
                        lastName={member.last_name}
                        email={member.email}
                        membershipNumber={member.member_id}
                        showMembershipNumber={true}
                        showEmail={true}
                        fromPath={`/admin/reports/registrations/${registrationId}`}
                        fromLabel={registrationName || 'Registration Detail'}
                        className="line-through"
                      />
                      <span className="text-gray-500">{member.category_name}</span>
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
                  Waitlist ({filteredWaitlistData.length}{filteredWaitlistData.length !== waitlistData.length ? ` of ${waitlistData.length}` : ''})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        { key: 'position', label: 'Pos' },
                        { key: 'first_name', label: 'Name' },
                        { key: 'category_name', label: 'Category' },
                        { key: 'is_lgbtq', label: 'LGBTQ+' },
                        { key: 'is_goalie', label: 'Goalie' },
                        { key: 'joined_at', label: 'Joined' },
                      ].map(({ key, label }) => (
                        <th
                          key={key}
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleWaitlistSort(key as keyof WaitlistData)}
                        >
                          {label}{waitlistSortIndicator(key as keyof WaitlistData)}
                        </th>
                      ))}
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Payment
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Discount
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedWaitlistData.map((waitlist) => (
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
                            fromPath={`/admin/reports/registrations/${registrationId}`}
                            fromLabel={registrationName || 'Registration Detail'}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getCategoryPillStyles()}`}>
                            {waitlist.category_name}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getLgbtqStatusStyles(waitlist.is_lgbtq)}`}>
                            {getLgbtqStatusLabel(waitlist.is_lgbtq)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getGoalieStatusStyles(waitlist.is_goalie)}`}>
                            {getGoalieStatusLabel(waitlist.is_goalie)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>
                            <div>{formatDateTime(waitlist.joined_at).date}</div>
                            {formatDateTime(waitlist.joined_at).time && (
                              <div className="text-xs text-gray-500">{formatDateTime(waitlist.joined_at).time}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {waitlist.hasValidPaymentMethod ? (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                              Setup Required
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {waitlist.discount_code ? (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                              {waitlist.discount_code} (-{waitlist.discount_percentage}%)
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => {
                              setSelectedWaitlistEntry(waitlist)
                              setShowWaitlistSelectionModal(true)
                            }}
                            disabled={!waitlist.hasValidPaymentMethod}
                            className={`inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm ${
                              waitlist.hasValidPaymentMethod
                                ? 'text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500'
                                : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                            }`}
                            title={waitlist.hasValidPaymentMethod ? 'Select user from waitlist' : 'User must set up payment method first'}
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedWaitlistData.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-500">
                          No waitlist entries match the current search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Alternates */}
          {alternatesData.length > 0 && (() => {
            const filteredAlternatesData = alternatesData.filter(alternate => {
              const fullName = `${alternate.first_name} ${alternate.last_name}`.toLowerCase()
              const email = alternate.email.toLowerCase()
              const search = searchTerm.toLowerCase()
              return fullName.includes(search) || email.includes(search)
            })

            const sortedAlternatesData = [...filteredAlternatesData].sort((a, b) => {
              let aValue = a[alternatesSortField]
              let bValue = b[alternatesSortField]

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

            const altSortIndicator = (key: string) =>
              alternatesSortField === key ? (alternatesSortDirection === 'asc' ? ' ↑' : ' ↓') : ''

            return (
              <div className="bg-white shadow rounded-lg overflow-hidden mb-8">
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
                            {label}{altSortIndicator(key)}
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
                              fromPath={`/admin/reports/registrations/${registrationId}`}
                              fromLabel={registrationName || 'Registration Detail'}
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getLgbtqStatusStyles(alternate.is_lgbtq)}`}>
                              {getLgbtqStatusLabel(alternate.is_lgbtq)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getGoalieStatusStyles(alternate.is_goalie)}`}>
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
          <div className="mt-6">
            <Link
              href="/admin/reports/registrations"
              className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-800"
            >
              <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              Return to Registrations
            </Link>
          </div>
        </>
      )}

      {/* Waitlist Selection Modal */}
      {showWaitlistSelectionModal && selectedWaitlistEntry && (
        <WaitlistSelectionModal
          waitlistEntry={selectedWaitlistEntry}
          registrationName={registrationName}
          onSuccess={() => {
            setShowWaitlistSelectionModal(false)
            setSelectedWaitlistEntry(null)
            fetchRegistrationData(registrationId)
          }}
          onCancel={() => {
            setShowWaitlistSelectionModal(false)
            setSelectedWaitlistEntry(null)
          }}
        />
      )}
    </div>
  )
}
