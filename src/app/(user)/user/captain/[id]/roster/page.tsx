'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getLgbtqStatusLabel, getLgbtqStatusStyles, getGoalieStatusLabel, getGoalieStatusStyles } from '@/lib/user-attributes'

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
  selections: Array<{
    game_description: string
    game_date: string
    amount_charged: number
    selected_at: string
  }>
}

export default function CaptainRosterPage() {
  const params = useParams()
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
  const [alternatesSortField, setAlternatesSortField] = useState<keyof AlternateData>('first_name')
  const [alternatesSortDirection, setAlternatesSortDirection] = useState<'asc' | 'desc'>('asc')

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

  const handleAlternatesSort = (field: keyof AlternateData) => {
    if (alternatesSortField === field) {
      setAlternatesSortDirection(alternatesSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setAlternatesSortField(field)
      setAlternatesSortDirection('asc')
    }
  }

  const getPaymentStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'paid':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">✓ Paid</span>
      case 'awaiting_payment':
      case 'processing':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">⏳ Pending</span>
      case 'failed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">✗ Failed</span>
      case 'refunded':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">↩ Refunded</span>
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{status}</span>
    }
  }

  const filteredRegistrations = registrationData.filter(registration => {
    const fullName = `${registration.first_name} ${registration.last_name}`.toLowerCase()
    const email = registration.email?.toLowerCase() || ''
    const search = searchTerm.toLowerCase()
    return fullName.includes(search) || email.includes(search)
  })

  // Separate refunded and active members
  const activeMembers = filteredRegistrations.filter(r => r.payment_status !== 'refunded')
  const refundedMembers = filteredRegistrations.filter(r => r.payment_status === 'refunded')

  // Sort active members
  const sortedMembers = [...activeMembers].sort((a, b) => {
    let aValue = a[sortField]
    let bValue = b[sortField]

    if (sortField === 'is_lgbtq') {
      aValue = getLgbtqStatusLabel(a.is_lgbtq)
      bValue = getLgbtqStatusLabel(b.is_lgbtq)
    } else if (sortField === 'is_goalie') {
      aValue = getGoalieStatusLabel(a.is_goalie)
      bValue = getGoalieStatusLabel(b.is_goalie)
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

  // Payment status summary
  const paidCount = registrationData.filter(r => r.payment_status === 'paid').length
  const pendingCount = registrationData.filter(r => r.payment_status === 'awaiting_payment' || r.payment_status === 'processing').length
  const failedCount = registrationData.filter(r => r.payment_status === 'failed').length
  const refundedCount = refundedMembers.length

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Back Link */}
      <div className="mb-4">
        <Link
          href="/user/captain"
          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
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
          {/* Payment Status Summary */}
          <div className="mb-6 bg-white shadow rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Payment Status Summary</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mr-2">✓ Paid</span>
                <span className="font-semibold">{paidCount} members</span>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 mr-2">⏳ Pending</span>
                  <span className="font-semibold">{pendingCount}</span>
                </div>
              )}
              {failedCount > 0 && (
                <div className="flex items-center">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 mr-2">✗ Failed</span>
                  <span className="font-semibold">{failedCount}</span>
                </div>
              )}
              {refundedCount > 0 && (
                <div className="flex items-center">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 mr-2">↩ Refunded</span>
                  <span className="font-semibold">{refundedCount}</span>
                </div>
              )}
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
                Roster ({activeMembers.length} active members)
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
                      Name {sortField === 'first_name' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Member ID
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('is_lgbtq')}
                    >
                      LGBTQ {sortField === 'is_lgbtq' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('is_goalie')}
                    >
                      Goalie {sortField === 'is_goalie' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {member.first_name} {member.last_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        #{member.member_id || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {member.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {getPaymentStatusBadge(member.payment_status)}
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
                    </tr>
                  ))}
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
                      <span className="ml-2">{getPaymentStatusBadge(member.payment_status)}</span>
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
                        Email
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        LGBTQ
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {waitlist.first_name} {waitlist.last_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {waitlist.email}
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
              let aValue = a[alternatesSortField]
              let bValue = b[alternatesSortField]

              if (alternatesSortField === 'is_lgbtq') {
                aValue = getLgbtqStatusLabel(a.is_lgbtq)
                bValue = getLgbtqStatusLabel(b.is_lgbtq)
              } else if (alternatesSortField === 'is_goalie') {
                aValue = getGoalieStatusLabel(a.is_goalie)
                bValue = getGoalieStatusLabel(b.is_goalie)
              }

              if (alternatesSortField === 'times_played') {
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
                          { key: 'email', label: 'Email' },
                          { key: 'is_lgbtq', label: 'LGBTQ+' },
                          { key: 'is_goalie', label: 'Goalie' },
                          { key: 'times_played', label: 'Times Played' }
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
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {alternate.email}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
