'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getLgbtqStatusLabel, getLgbtqStatusStyles, getGoalieStatusLabel, getGoalieStatusStyles } from '@/lib/user-attributes'
import WaitlistSelectionModal from '@/components/WaitlistSelectionModal'
import UserLink from '@/components/UserLink'
import InvoiceDetailLink from '@/components/InvoiceDetailLink'
import { formatDate as formatDateUtil, formatTime as formatTimeUtil } from '@/lib/date-utils'
import { buildBreadcrumbUrl } from '@/lib/breadcrumb-utils'

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
  selections: Array<{
    game_description: string
    game_date: string
    amount_charged: number
    selected_at: string
  }>
}

export default function RegistrationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const registrationId = params.id as string

  const [registrationData, setRegistrationData] = useState<RegistrationData[]>([])
  const [waitlistData, setWaitlistData] = useState<WaitlistData[]>([])
  const [alternatesData, setAlternatesData] = useState<AlternateData[]>([])
  const [registrationName, setRegistrationName] = useState('')
  const [seasonName, setSeasonName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof RegistrationData>('first_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [waitlistSortField, setWaitlistSortField] = useState<keyof WaitlistData>('joined_at')
  const [waitlistSortDirection, setWaitlistSortDirection] = useState<'asc' | 'desc'>('asc')
  const [alternatesSortField, setAlternatesSortField] = useState<keyof AlternateData>('first_name')
  const [alternatesSortDirection, setAlternatesSortDirection] = useState<'asc' | 'desc'>('asc')
  const [isWaitlistExpanded, setIsWaitlistExpanded] = useState(true)
  const [isRegistrationsExpanded, setIsRegistrationsExpanded] = useState(true)
  const [isAlternatesExpanded, setIsAlternatesExpanded] = useState(true)
  const [selectedWaitlistEntry, setSelectedWaitlistEntry] = useState<WaitlistData | null>(null)
  const [showWaitlistSelectionModal, setShowWaitlistSelectionModal] = useState(false)

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

  const formatCurrency = (amount: number) => {
    return `$${(amount / 100).toFixed(2)}`
  }

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return {
      date: formatDateUtil(date),
      time: formatTimeUtil(date)
    }
  }

  const filteredRegistrations = registrationData.filter(registration => {
    const fullName = `${registration.first_name} ${registration.last_name}`.toLowerCase()
    const email = registration.email?.toLowerCase() || ''
    const category = registration.category_name?.toLowerCase() || ''
    const search = searchTerm.toLowerCase()

    return fullName.includes(search) || email.includes(search) || category.includes(search)
  })

  const sortWaitlistData = (data: WaitlistData[]) => {
    return [...data].sort((a, b) => {
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
        const aDate = new Date(a.joined_at).getTime()
        const bDate = new Date(b.joined_at).getTime()
        return waitlistSortDirection === 'asc' ? aDate - bDate : bDate - aDate
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return waitlistSortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      return 0
    })
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Back Navigation */}
      <div className="mb-6">
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

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, email, or category..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Waitlist Section - Organized by Category */}
      {waitlistData && waitlistData.length > 0 && (() => {
        // Filter waitlist data by search term
        const filteredWaitlistData = waitlistData.filter(waitlist => {
          const fullName = `${waitlist.first_name} ${waitlist.last_name}`.toLowerCase()
          const email = waitlist.email.toLowerCase()
          const category = waitlist.category_name.toLowerCase()
          const search = searchTerm.toLowerCase()

          return fullName.includes(search) || email.includes(search) || category.includes(search)
        })

        // Group filtered waitlist data by category
        const waitlistByCategory = filteredWaitlistData.reduce((acc, waitlist) => {
          const category = waitlist.category_name
          if (!acc[category]) {
            acc[category] = []
          }
          acc[category].push(waitlist)
          return acc
        }, {} as Record<string, WaitlistData[]>)

        return (
          <div className="mb-8 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Waitlist ({filteredWaitlistData.length}{filteredWaitlistData.length !== waitlistData.length ? ` of ${waitlistData.length}` : ''} total)
              </h3>
              <button
                onClick={() => setIsWaitlistExpanded(!isWaitlistExpanded)}
                className="flex items-center text-sm text-indigo-600 hover:text-indigo-800"
              >
                {isWaitlistExpanded ? 'Collapse' : 'Expand'}
                <span className="ml-1">
                  {isWaitlistExpanded ? '↑' : '↓'}
                </span>
              </button>
            </div>
            {isWaitlistExpanded && (
              <>
                {filteredWaitlistData.length === 0 ? (
                  <div className="bg-white p-6 rounded-lg shadow">
                    <p className="text-gray-500 text-center">No waitlist entries match your search criteria.</p>
                  </div>
                ) : (
                  Object.entries(waitlistByCategory).map(([categoryName, categoryWaitlist]) => {
                    const sortedCategoryWaitlist = sortWaitlistData(categoryWaitlist)

                    return (
                      <div key={categoryName} className="bg-white p-6 rounded-lg shadow">
                        <h4 className="text-md font-semibold text-gray-900 mb-4">
                          {categoryName} ({categoryWaitlist.length})
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                {[
                                  { key: 'first_name', label: 'Participant' },
                                  { key: 'email', label: 'Email' },
                                  { key: 'is_lgbtq', label: 'LGBTQ+' },
                                  { key: 'is_goalie', label: 'Goalie' },
                                  { key: 'joined_at', label: 'Joined' }
                                ].map(({ key, label }) => (
                                  <th
                                    key={key}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleWaitlistSort(key as keyof WaitlistData)}
                                  >
                                    <div className="flex items-center">
                                      {label}
                                      {waitlistSortField === key && (
                                        <span className="ml-1">
                                          {waitlistSortDirection === 'asc' ? '↑' : '↓'}
                                        </span>
                                      )}
                                    </div>
                                  </th>
                                ))}
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Payment Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Discount Code
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Action
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {sortedCategoryWaitlist.map((waitlist) => (
                                <tr key={waitlist.id} className="hover:bg-gray-50">
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {waitlist.first_name} {waitlist.last_name}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {waitlist.email}
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
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* Registrations Section - Organized by Category */}
      {registrationData && registrationData.length > 0 && (() => {
        // Group registration data by category
        const registrationsByCategory = filteredRegistrations.reduce((acc, registration) => {
          const category = registration.category_name
          if (!acc[category]) {
            acc[category] = []
          }
          acc[category].push(registration)
          return acc
        }, {} as Record<string, RegistrationData[]>)

        return (
          <div className="mb-8 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Registrations ({filteredRegistrations.length}{filteredRegistrations.length !== registrationData.length ? ` of ${registrationData.length}` : ''} total)
              </h3>
              <button
                onClick={() => setIsRegistrationsExpanded(!isRegistrationsExpanded)}
                className="flex items-center text-sm text-indigo-600 hover:text-indigo-800"
              >
                {isRegistrationsExpanded ? 'Collapse' : 'Expand'}
                <span className="ml-1">
                  {isRegistrationsExpanded ? '↑' : '↓'}
                </span>
              </button>
            </div>
            {isRegistrationsExpanded && (
              <>
                {loading ? (
                  <div className="bg-white p-6 rounded-lg shadow">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                      <p className="mt-2 text-gray-600">Loading registrations...</p>
                    </div>
                  </div>
                ) : filteredRegistrations.length === 0 ? (
                  <div className="bg-white p-6 rounded-lg shadow">
                    <p className="text-gray-500 text-center">No registrations match your search criteria.</p>
                  </div>
                ) : (
                  Object.entries(registrationsByCategory).map(([categoryName, categoryRegistrations]) => {
                    const sortedCategoryRegistrations = [...categoryRegistrations].sort((a, b) => {
                      let aValue = a[sortField]
                      let bValue = b[sortField]

                      // Handle boolean fields by converting to display labels for proper sorting
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

                    // Count paid and refunded registrations separately
                    const paidCount = categoryRegistrations.filter(r => r.payment_status === 'paid').length
                    const refundedCount = categoryRegistrations.filter(r => r.payment_status === 'refunded').length

                    return (
                      <div key={categoryName} className="bg-white p-6 rounded-lg shadow">
                        <h4 className="text-md font-semibold text-gray-900 mb-4">
                          {categoryName} ({paidCount} paid{refundedCount > 0 ? `, ${refundedCount} refunded` : ''})
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                {[
                                  { key: 'first_name', label: 'Participant' },
                                  { key: 'payment_status', label: 'Payment Status' },
                                  { key: 'is_lgbtq', label: 'LGBTQ+' },
                                  { key: 'is_goalie', label: 'Goalie' },
                                  { key: 'amount_paid', label: 'Amount Paid' },
                                  { key: 'registered_at', label: 'Registered At' },
                                  { key: 'presale_code_used', label: 'Presale Code' }
                                ].map(({ key, label }) => (
                                  <th
                                    key={key}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleSort(key as keyof RegistrationData)}
                                  >
                                    <div className="flex items-center">
                                      {label}
                                      {sortField === key && (
                                        <span className="ml-1">
                                          {sortDirection === 'asc' ? '↑' : '↓'}
                                        </span>
                                      )}
                                    </div>
                                  </th>
                                ))}
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Details
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {sortedCategoryRegistrations.map((registration, index) => (
                                <tr key={index} className={`hover:bg-gray-50 ${registration.payment_status === 'refunded' ? 'opacity-60' : ''}`}>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <UserLink
                                      userId={registration.user_id}
                                      firstName={registration.first_name}
                                      lastName={registration.last_name}
                                      email={registration.email}
                                      membershipNumber={registration.member_id}
                                      showMembershipNumber={true}
                                      fromPath={`/admin/reports/registrations/${registrationId}`}
                                      fromLabel={registrationName || 'Registration Detail'}
                                    />
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                      registration.payment_status === 'paid'
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-red-100 text-red-800'
                                    }`}>
                                      {registration.payment_status === 'paid' ? 'Yes' : 'No'}
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
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                    {formatCurrency(registration.amount_paid)}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    <div>
                                      <div>{formatDateTime(registration.registered_at).date}</div>
                                      {formatDateTime(registration.registered_at).time && (
                                        <div className="text-xs text-gray-500">{formatDateTime(registration.registered_at).time}</div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {registration.presale_code_used ? (
                                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                                        {registration.presale_code_used}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    {registration.payment_id ? (
                                      <InvoiceDetailLink
                                        userId={registration.user_id}
                                        invoiceId={registration.payment_id}
                                        label="Detail"
                                        showIcon={false}
                                        fromPath={`/admin/reports/registrations/${registrationId}`}
                                        fromLabel={registrationName || 'Registration Detail'}
                                      />
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
                  })
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* Alternates Section */}
      {alternatesData && alternatesData.length > 0 && (() => {
        // Filter alternates data by search term
        const filteredAlternatesData = alternatesData.filter(alternate => {
          const fullName = `${alternate.first_name} ${alternate.last_name}`.toLowerCase()
          const email = alternate.email.toLowerCase()
          const search = searchTerm.toLowerCase()

          return fullName.includes(search) || email.includes(search)
        })

        // Sort alternates data
        const sortedAlternatesData = [...filteredAlternatesData].sort((a, b) => {
          let aValue = a[alternatesSortField]
          let bValue = b[alternatesSortField]

          // Handle boolean fields by converting to display labels for proper sorting
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

          if (typeof aValue === 'string' && typeof bValue === 'string') {
            return alternatesSortDirection === 'asc'
              ? aValue.localeCompare(bValue)
              : bValue.localeCompare(aValue)
          }

          return 0
        })

        return (
          <div className="mb-8 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Alternates ({filteredAlternatesData.length}{filteredAlternatesData.length !== alternatesData.length ? ` of ${alternatesData.length}` : ''} total)
              </h3>
              <button
                onClick={() => setIsAlternatesExpanded(!isAlternatesExpanded)}
                className="flex items-center text-sm text-indigo-600 hover:text-indigo-800"
              >
                {isAlternatesExpanded ? 'Collapse' : 'Expand'}
                <span className="ml-1">
                  {isAlternatesExpanded ? '↑' : '↓'}
                </span>
              </button>
            </div>
            {isAlternatesExpanded && (
              <>
                {filteredAlternatesData.length === 0 ? (
                  <div className="bg-white p-6 rounded-lg shadow">
                    <p className="text-gray-500 text-center">No alternates match your search criteria.</p>
                  </div>
                ) : (
                  <div className="bg-white p-6 rounded-lg shadow">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            {[
                              { key: 'first_name', label: 'Participant' },
                              { key: 'email', label: 'Email' },
                              { key: 'is_lgbtq', label: 'LGBTQ+' },
                              { key: 'is_goalie', label: 'Goalie' },
                              { key: 'times_played', label: 'Times Played' },
                              { key: 'total_paid', label: 'Total Paid' }
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
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {alternate.first_name} {alternate.last_name}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {alternate.email}
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* Waitlist Selection Modal */}
      {showWaitlistSelectionModal && selectedWaitlistEntry && (
        <WaitlistSelectionModal
          waitlistEntry={selectedWaitlistEntry}
          registrationName={registrationName}
          onSuccess={() => {
            setShowWaitlistSelectionModal(false)
            setSelectedWaitlistEntry(null)
            // Refresh the registration data
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
