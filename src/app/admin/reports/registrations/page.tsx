'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { getLgbtqStatusLabel, getLgbtqStatusStyles, getGoalieStatusLabel, getGoalieStatusStyles, getCategoryPillStyles } from '@/lib/user-attributes'

interface Registration {
  id: string
  name: string
  season_name: string
  type: string
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

interface RegistrationData {
  registration_id: string
  registration_name: string
  season_name: string
  registration_type: string
  user_id: string
  full_name: string
  email: string
  category_name: string
  registration_category_name: string
  payment_status: string
  amount_paid: number
  registered_at: string
  registration_fee: number
  presale_code_used: string | null
  is_lgbtq: boolean | null
  is_goalie: boolean
}

interface WaitlistData {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  category_name: string
  position: number
  joined_at: string
  bypass_code_generated: boolean
}



export default function RegistrationReportsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [selectedRegistration, setSelectedRegistration] = useState<string>('')
  const [registrationData, setRegistrationData] = useState<RegistrationData[]>([])
  const [waitlistData, setWaitlistData] = useState<WaitlistData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof RegistrationData>('full_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const searchParams = useSearchParams()

  useEffect(() => {
    fetchRegistrations()
  }, [])

  useEffect(() => {
    if (selectedRegistration && selectedRegistration.trim() !== '') {
      fetchRegistrationData(selectedRegistration)
    }
  }, [selectedRegistration])

  const fetchRegistrations = async () => {
    try {
      setError(null)
      const response = await fetch('/api/admin/reports/registrations')
      
      if (!response.ok) {
        throw new Error(`Failed to load registrations: ${response.statusText}`)
      }
      
      const result = await response.json()
      const data = result.data

      if (!data) {
        setError('No registrations found')
        return
      }
      
      setRegistrations(data || [])
      if (data && data.length > 0) {
        // Check if there's a registrationId in the URL query params
        const registrationIdFromUrl = searchParams.get('registrationId')
        if (registrationIdFromUrl && data.some((r: Registration) => r.id === registrationIdFromUrl)) {
          setSelectedRegistration(registrationIdFromUrl)
        } else {
          setSelectedRegistration(data[0].id)
        }
      }
    } catch (error) {
      console.error('Error fetching registrations:', error)
      setError(`Failed to load registrations: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const fetchRegistrationData = async (registrationId: string) => {
    setLoading(true)
    setError(null)
    try {
      console.log('Fetching registration data for:', registrationId)
      
      const response = await fetch(`/api/admin/reports/registrations?registrationId=${registrationId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to load registration data: ${response.statusText}`)
      }
      
      const result = await response.json()
      const registrationReportData = result.data
      const waitlistReportData = result.waitlistData || []

      console.log('Registration data received:', registrationReportData?.length || 0, 'records')
      console.log('Waitlist data received:', waitlistReportData?.length || 0, 'records')

      // Process the data
      const registrationsList: RegistrationData[] = registrationReportData?.map((item: any) => ({
        registration_id: item.registration_id?.toString() || 'N/A',
        registration_name: item.registration_name || 'N/A',
        season_name: item.season_name || 'N/A',
        registration_type: item.registration_type || 'N/A',
        user_id: item.user_id?.toString() || 'N/A',
        full_name: `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'N/A',
        email: item.email || 'N/A',
        category_name: item.category_name || item.registration_category_name || 'N/A',
        registration_category_name: item.registration_category_name || 'N/A',
        payment_status: item.payment_status || 'N/A',
        amount_paid: item.amount_paid || 0,
        registered_at: item.registered_at || 'N/A',
        registration_fee: item.registration_fee || 0,
        presale_code_used: item.presale_code_used || null,
        is_lgbtq: item.is_lgbtq,
        is_goalie: item.is_goalie || false
      })) || []

      // Process the waitlist data
      const waitlistList: WaitlistData[] = waitlistReportData?.map((item: any) => ({
        id: item.id,
        user_id: item.user_id,
        first_name: item.first_name || '',
        last_name: item.last_name || '',
        email: item.email || 'Unknown',
        category_name: item.category_name || 'Unknown Category',
        position: item.position || 0,
        joined_at: item.joined_at || 'N/A',
        bypass_code_generated: item.bypass_code_generated || false
      })) || []

      console.log('Processed registrations:', registrationsList.length)
      console.log('Processed waitlist:', waitlistList.length)
      setRegistrationData(registrationsList)
      setWaitlistData(waitlistList)



    } catch (error) {
      console.error('Error fetching registration data:', error)
      setError(`Failed to load registration data: ${error instanceof Error ? error.message : 'Unknown error'}`)
      // Set empty data on error
      setRegistrationData([])
      setWaitlistData([])
    } finally {
      setLoading(false)
    }
  }

  const filteredRegistrations = registrationData.filter(registration =>
    registration.registration_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    registration.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    registration.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    registration.category_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const sortedRegistrations = [...filteredRegistrations].sort((a, b) => {
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

  const handleSort = (field: keyof RegistrationData) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount / 100) // Convert cents to dollars
  }

  const formatDate = (dateString: string) => {
    if (dateString === 'N/A') return 'N/A'
    return new Date(dateString).toLocaleDateString()
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

  return (
    <div className="container mx-auto px-4 py-8">
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

      {/* Registration Selection Tiles */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Registration</h2>
        {loading && registrations.length === 0 ? (
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
            {registrations.map((registration) => (
              <button
                key={registration.id}
                onClick={() => setSelectedRegistration(registration.id)}
                className={`p-6 rounded-lg border-2 transition-all duration-200 text-left hover:shadow-md ${
                  selectedRegistration === registration.id
                    ? 'border-indigo-500 bg-indigo-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
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

      {selectedRegistration && (
        <>


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

          {/* Registrations Table */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Registrations ({filteredRegistrations.length} of {registrationData.length})
              </h3>
            </div>
            
            {loading ? (
              <div className="px-4 py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading registrations...</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        { key: 'full_name', label: 'Participant' },
                        { key: 'email', label: 'Email' },
                        { key: 'category_name', label: 'Category' },
                        { key: 'is_lgbtq', label: 'LGBTQ+' },
                        { key: 'is_goalie', label: 'Goalie' },
                        { key: 'amount_paid', label: 'Amount Paid' },
                        { key: 'registration_fee', label: 'Registration Fee' },
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
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedRegistrations.map((registration, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {registration.full_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {registration.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getCategoryPillStyles()}`}>
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                          {formatCurrency(registration.amount_paid)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(registration.registration_fee)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(registration.registered_at)}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Waitlist Section */}
          {waitlistData && waitlistData.length > 0 && (
            <div className="mb-8">
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Waitlist ({waitlistData.length})</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Position</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Participant</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bypass Code</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {waitlistData.map((waitlist) => (
                        <tr key={waitlist.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            #{waitlist.position}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {waitlist.first_name} {waitlist.last_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {waitlist.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {waitlist.category_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(waitlist.joined_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {waitlist.bypass_code_generated ? (
                              <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                Generated
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                Not Generated
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}