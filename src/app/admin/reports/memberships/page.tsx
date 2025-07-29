'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface MembershipType {
  id: string
  name: string
  description: string
}

interface MemberData {
  member_id: string
  full_name: string
  email: string
  member_since: string
  expiration_date: string
  days_to_expiration: number
  is_lgbtq: boolean | null
  lgbtq_status: string
}

interface MembershipStats {
  total_members: number
  lgbtq_count: number
  lgbtq_percent: number
  prefer_not_to_say_count: number
}

export default function MembershipReportsPage() {
  const [membershipTypes, setMembershipTypes] = useState<MembershipType[]>([])
  const [selectedMembership, setSelectedMembership] = useState<string>('')
  const [members, setMembers] = useState<MemberData[]>([])
  const [stats, setStats] = useState<MembershipStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof MemberData>('member_id')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const supabase = createClient()

  useEffect(() => {
    fetchMembershipTypes()
  }, [])

  useEffect(() => {
    if (selectedMembership && selectedMembership.trim() !== '') {
      fetchMembershipData(selectedMembership)
    }
  }, [selectedMembership])

  const fetchMembershipTypes = async () => {
    try {
      setError(null)
      const { data, error } = await supabase
        .from('memberships')
        .select('id, name, description')
        .order('name')

      if (error) {
        console.error('Error fetching membership types:', error)
        setError(`Failed to load membership types: ${error.message}`)
        return
      }
      
      setMembershipTypes(data || [])
      if (data && data.length > 0) {
        setSelectedMembership(data[0].id)
      }
    } catch (error) {
      console.error('Error fetching membership types:', error)
      setError(`Failed to load membership types: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const fetchMembershipData = async (membershipId: string) => {
    setLoading(true)
    setError(null)
    try {
      console.log('Fetching membership data for:', membershipId)
      
      // Get the latest valid_until date for each user's membership of this type
      const { data: membershipData, error } = await supabase
        .from('user_memberships')
        .select(`
          user_id,
          valid_until,
          payment_status,
          users (
            member_id,
            first_name,
            last_name,
            email,
            onboarding_completed_at,
            is_lgbtq
          )
        `)
        .eq('membership_id', membershipId)
        .eq('payment_status', 'paid') // Only paid memberships
        .gte('valid_until', new Date().toISOString()) // Only active memberships
        .order('valid_until', { ascending: false })

      if (error) {
        console.error('Supabase error:', error)
        setError(`Failed to load membership data: ${error.message}`)
        return
      }

      console.log('Membership data received:', membershipData?.length || 0, 'records')

      // Process the data
      const memberMap = new Map<string, MemberData>()
      
      membershipData?.forEach((item: any) => {
        const user = item.users
        if (!user) {
          console.log('Skipping item with no user:', item)
          return
        }

        // Only keep the latest valid_until for each user
        const existing = memberMap.get(user.member_id)
        if (!existing || new Date(item.valid_until) > new Date(existing.expiration_date)) {
          const expirationDate = new Date(item.valid_until)
          const daysToExpiration = Math.ceil((expirationDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
          
          // Determine LGBTQ+ status
          let lgbtqStatus = 'No Response'
          if (user.is_lgbtq === true) {
            lgbtqStatus = 'LGBTQ+'
          } else if (user.is_lgbtq === false) {
            lgbtqStatus = 'Ally'
          }

          memberMap.set(user.member_id, {
            member_id: user.member_id || 'N/A',
            full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'N/A',
            email: user.email || 'N/A',
            member_since: user.onboarding_completed_at || 'N/A',
            expiration_date: item.valid_until,
            days_to_expiration: daysToExpiration,
            is_lgbtq: user.is_lgbtq,
            lgbtq_status: lgbtqStatus
          })
        }
      })

      const membersList = Array.from(memberMap.values())
      console.log('Processed members:', membersList.length)
      setMembers(membersList)

      // Calculate stats
      const totalMembers = membersList.length
      const lgbtqCount = membersList.filter(m => m.is_lgbtq === true).length
      const preferNotToSayCount = membersList.filter(m => m.is_lgbtq === null).length
      const lgbtqPercent = totalMembers - preferNotToSayCount > 0 
        ? (lgbtqCount / (totalMembers - preferNotToSayCount)) * 100 
        : 0

      setStats({
        total_members: totalMembers,
        lgbtq_count: lgbtqCount,
        lgbtq_percent: lgbtqPercent,
        prefer_not_to_say_count: preferNotToSayCount
      })

    } catch (error) {
      console.error('Error fetching membership data:', error)
      setError(`Failed to load membership data: ${error instanceof Error ? error.message : 'Unknown error'}`)
      // Set empty data on error
      setMembers([])
      setStats({
        total_members: 0,
        lgbtq_count: 0,
        lgbtq_percent: 0,
        prefer_not_to_say_count: 0
      })
    } finally {
      setLoading(false)
    }
  }

  const filteredMembers = members.filter(member =>
    member.member_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const sortedMembers = [...filteredMembers].sort((a, b) => {
    const aValue = a[sortField]
    const bValue = b[sortField]
    
    if (sortField === 'days_to_expiration') {
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

  const handleSort = (field: keyof MemberData) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const formatDate = (dateString: string) => {
    if (dateString === 'N/A') return 'N/A'
    return new Date(dateString).toLocaleDateString()
  }

  const getExpirationStatus = (days: number) => {
    if (days < 0) return 'Expired'
    if (days <= 30) return 'Expiring Soon'
    if (days <= 90) return 'Expiring'
    return 'Active'
  }

  const getExpirationColor = (days: number) => {
    if (days < 0) return 'text-red-600'
    if (days <= 30) return 'text-orange-600'
    if (days <= 90) return 'text-yellow-600'
    return 'text-green-600'
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Membership Reports</h1>
        <p className="text-gray-600">Detailed analytics and member listings by membership type</p>
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

      {/* Membership Type Tiles */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Membership Type</h2>
        {loading && membershipTypes.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-100 rounded-lg p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {membershipTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedMembership(type.id)}
                className={`p-6 rounded-lg border-2 transition-all duration-200 text-left hover:shadow-md ${
                  selectedMembership === type.id
                    ? 'border-indigo-500 bg-indigo-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{type.name}</h3>
                {type.description && (
                  <p className="text-sm text-gray-600 mb-3">{type.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${
                    selectedMembership === type.id ? 'text-indigo-600' : 'text-gray-500'
                  }`}>
                    {selectedMembership === type.id ? 'Selected' : 'Click to view'}
                  </span>
                  {selectedMembership === type.id && (
                    <svg className="h-5 w-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedMembership && (
        <>
          {/* Summary Statistics */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">Total Members</h3>
                <p className="text-3xl font-bold text-indigo-600">{stats.total_members}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">LGBTQ+ Members</h3>
                <p className="text-3xl font-bold text-purple-600">{stats.lgbtq_count}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">LGBTQ+ Percentage</h3>
                <p className="text-3xl font-bold text-green-600">{stats.lgbtq_percent.toFixed(1)}%</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">Prefer Not to Say</h3>
                <p className="text-3xl font-bold text-gray-600">{stats.prefer_not_to_say_count}</p>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search by member ID, name, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Members Table */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Members ({filteredMembers.length} of {members.length})
              </h3>
            </div>
            
            {loading ? (
              <div className="px-4 py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading members...</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        { key: 'member_id', label: 'Member ID' },
                        { key: 'full_name', label: 'Full Name' },
                        { key: 'email', label: 'Email' },
                        { key: 'lgbtq_status', label: 'LGBTQ+' },
                        { key: 'member_since', label: 'Member Since' },
                        { key: 'expiration_date', label: 'Expiration Date' },
                        { key: 'days_to_expiration', label: 'Days to Expiration' }
                      ].map(({ key, label }) => (
                        <th
                          key={key}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort(key as keyof MemberData)}
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
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedMembers.map((member, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {member.member_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {member.full_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {member.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            member.lgbtq_status === 'LGBTQ+' 
                              ? 'bg-purple-100 text-purple-800' 
                              : member.lgbtq_status === 'Ally'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {member.lgbtq_status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(member.member_since)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(member.expiration_date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`font-medium ${getExpirationColor(member.days_to_expiration)}`}>
                            {member.days_to_expiration} days
                          </span>
                          <span className="ml-2 text-xs text-gray-500">
                            ({getExpirationStatus(member.days_to_expiration)})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
} 