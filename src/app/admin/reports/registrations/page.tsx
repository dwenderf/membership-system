'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface Registration {
  id: string
  name: string
  season_name: string
  type: string
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
}

interface RegistrationStats {
  total_registrations: number
  total_revenue: number
  average_registration_fee: number
  paid_registrations: number
  pending_registrations: number
  failed_registrations: number
  category_breakdown: Array<{
    category: string
    count: number
    revenue: number
  }>
  payment_status_breakdown: Array<{
    status: string
    count: number
    revenue: number
  }>
}

export default function RegistrationReportsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [selectedRegistration, setSelectedRegistration] = useState<string>('')
  const [registrationData, setRegistrationData] = useState<RegistrationData[]>([])
  const [stats, setStats] = useState<RegistrationStats | null>(null)
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

      console.log('Registration data received:', registrationReportData?.length || 0, 'records')

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
        presale_code_used: item.presale_code_used || null
      })) || []

      console.log('Processed registrations:', registrationsList.length)
      setRegistrationData(registrationsList)

      // Calculate statistics
      if (registrationsList.length > 0) {
        const totalRevenue = registrationsList.reduce((sum, reg) => sum + (reg.amount_paid || 0), 0)
        const paidCount = registrationsList.filter(r => r.payment_status === 'paid').length
        const pendingCount = registrationsList.filter(r => r.payment_status === 'awaiting_payment').length
        const failedCount = registrationsList.filter(r => r.payment_status === 'failed').length
        
        // Category breakdown
        const categoryMap = new Map<string, { count: number, revenue: number }>()
        registrationsList.forEach(reg => {
          const category = reg.category_name
          const existing = categoryMap.get(category) || { count: 0, revenue: 0 }
          existing.count += 1
          existing.revenue += reg.amount_paid || 0
          categoryMap.set(category, existing)
        })

        // Payment status breakdown
        const statusMap = new Map<string, { count: number, revenue: number }>()
        registrationsList.forEach(reg => {
          const status = reg.payment_status
          const existing = statusMap.get(status) || { count: 0, revenue: 0 }
          existing.count += 1
          existing.revenue += reg.amount_paid || 0
          statusMap.set(status, existing)
        })

        setStats({
          total_registrations: registrationsList.length,
          total_revenue: totalRevenue,
          average_registration_fee: registrationsList.length > 0 ? totalRevenue / registrationsList.length : 0,
          paid_registrations: paidCount,
          pending_registrations: pendingCount,
          failed_registrations: failedCount,
          category_breakdown: Array.from(categoryMap.entries()).map(([category, data]) => ({
            category,
            count: data.count,
            revenue: data.revenue
          })),
          payment_status_breakdown: Array.from(statusMap.entries()).map(([status, data]) => ({
            status,
            count: data.count,
            revenue: data.revenue
          }))
        })
      } else {
        setStats({
          total_registrations: 0,
          total_revenue: 0,
          average_registration_fee: 0,
          paid_registrations: 0,
          pending_registrations: 0,
          failed_registrations: 0,
          category_breakdown: [],
          payment_status_breakdown: []
        })
      }

    } catch (error) {
      console.error('Error fetching registration data:', error)
      setError(`Failed to load registration data: ${error instanceof Error ? error.message : 'Unknown error'}`)
      // Set empty data on error
      setRegistrationData([])
      setStats({
        total_registrations: 0,
        total_revenue: 0,
        average_registration_fee: 0,
        paid_registrations: 0,
        pending_registrations: 0,
        failed_registrations: 0,
        category_breakdown: [],
        payment_status_breakdown: []
      })
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
    const aValue = a[sortField]
    const bValue = b[sortField]
    
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

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'text-green-600 bg-green-100'
      case 'awaiting_payment':
        return 'text-yellow-600 bg-yellow-100'
      case 'processing':
        return 'text-blue-600 bg-blue-100'
      case 'failed':
        return 'text-red-600 bg-red-100'
      case 'refunded':
        return 'text-gray-600 bg-gray-100'
      default:
        return 'text-gray-600 bg-gray-100'
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
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{registration.name}</h3>
                <p className="text-sm text-gray-600 mb-3">{registration.season_name}</p>
                <div className="flex items-center justify-between">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRegistrationTypeColor(registration.type)}`}>
                    {registration.type}
                  </span>
                  <span className={`text-sm font-medium ${
                    selectedRegistration === registration.id ? 'text-indigo-600' : 'text-gray-500'
                  }`}>
                    {selectedRegistration === registration.id ? 'Selected' : 'Click to view'}
                  </span>
                  {selectedRegistration === registration.id && (
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

      {selectedRegistration && (
        <>
          {/* Summary Statistics */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">Total Registrations</h3>
                <p className="text-3xl font-bold text-indigo-600">{stats.total_registrations}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">Total Revenue</h3>
                <p className="text-3xl font-bold text-green-600">{formatCurrency(stats.total_revenue)}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">Paid Registrations</h3>
                <p className="text-3xl font-bold text-green-600">{stats.paid_registrations}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900">Pending Registrations</h3>
                <p className="text-3xl font-bold text-yellow-600">{stats.pending_registrations}</p>
              </div>
            </div>
          )}

          {/* Category and Payment Status Breakdown */}
          {stats && (stats.category_breakdown.length > 0 || stats.payment_status_breakdown.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              {/* Category Breakdown */}
              {stats.category_breakdown.length > 0 && (
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Category Breakdown</h3>
                  <div className="space-y-3">
                    {stats.category_breakdown.map((category) => (
                      <div key={category.category} className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-gray-900">{category.category}</p>
                          <p className="text-sm text-gray-500">{category.count} registrations</p>
                        </div>
                        <p className="font-semibold text-gray-900">{formatCurrency(category.revenue)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment Status Breakdown */}
              {stats.payment_status_breakdown.length > 0 && (
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Status Breakdown</h3>
                  <div className="space-y-3">
                    {stats.payment_status_breakdown.map((status) => (
                      <div key={status.status} className="flex justify-between items-center">
                        <div>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPaymentStatusColor(status.status)}`}>
                            {status.status}
                          </span>
                          <p className="text-sm text-gray-500 mt-1">{status.count} registrations</p>
                        </div>
                        <p className="font-semibold text-gray-900">{formatCurrency(status.revenue)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                        { key: 'payment_status', label: 'Payment Status' },
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {registration.category_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPaymentStatusColor(registration.payment_status)}`}>
                            {registration.payment_status}
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
        </>
      )}
    </div>
  )
}