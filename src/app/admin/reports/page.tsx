'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface ReportData {
  dateRange: {
    start: string
    end: string
  }
  summary: {
    discountUsage: Array<{
      category: string
      timesUsed: number
      totalAmount: number
    }>
    discountUsageBreakdown?: Array<{
      categoryId: string
      name: string
      count: number
      total: number
      usages: Array<{
        id: string
        customerName: string
        discountCode: string
        amountSaved: number
        date: string
      }>
    }>
    donationsReceived: {
      transactionCount: number
      totalAmount: number
    }
    donationsGiven: {
      transactionCount: number
      totalAmount: number
    }
    donationDetails?: Array<{
      id: string
      customerName: string
      amount: number
      date: string
      type: 'received' | 'given'
    }>
    memberships: Array<{
      name: string
      purchaseCount: number
      totalAmount: number
    }>
    membershipsBreakdown?: Array<{
      membershipId: string
      name: string
      count: number
      total: number
      memberships: Array<{
        id: string
        customerName: string
        amount: number
        date: string
      }>
    }>
    registrations: {
      purchaseCount: number
      totalAmount: number
      breakdown?: Array<{
        registrationId: string
        name: string
        count: number
        total: number
        registrations: Array<{
          id: string
          customerName: string
          amount: number
          date: string
        }>
      }>
    }
  }
  recentTransactions: Array<{
    id: string
    invoiceNumber: string
    customerName: string
    amount: number
    type: string
    date: string
    status: string
  }>
}

const dateRanges = [
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Last 90 Days', value: '90d' }
]

export default function ReportsPage() {
  const [selectedRange, setSelectedRange] = useState('7d')
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedRegistrations, setExpandedRegistrations] = useState<Set<string>>(new Set())
  const [expandedMemberships, setExpandedMemberships] = useState<Set<string>>(new Set())
  const [expandedDiscountCategories, setExpandedDiscountCategories] = useState<Set<string>>(new Set())
  const [expandedDonations, setExpandedDonations] = useState<string | null>(null)
  const { showError } = useToast()

  const fetchReportData = async (range: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/reports?range=${range}`)
      if (!response.ok) {
        throw new Error('Failed to fetch report data')
      }
      const data = await response.json()
      setReportData(data)
    } catch (error) {
      console.error('Error fetching report data:', error)
      showError('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReportData(selectedRange)
  }, [selectedRange])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount / 100) // Convert cents to dollars
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const toggleRegistrationExpansion = (registrationId: string) => {
    setExpandedRegistrations(prev => {
      const newSet = new Set(prev)
      if (newSet.has(registrationId)) {
        newSet.delete(registrationId)
      } else {
        newSet.add(registrationId)
      }
      return newSet
    })
  }

  const toggleMembershipExpansion = (membershipName: string) => {
    setExpandedMemberships(prev => {
      const newSet = new Set(prev)
      if (newSet.has(membershipName)) {
        newSet.delete(membershipName)
      } else {
        newSet.add(membershipName)
      }
      return newSet
    })
  }

  const toggleDiscountCategoryExpansion = (categoryId: string) => {
    setExpandedDiscountCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId)
      } else {
        newSet.add(categoryId)
      }
      return newSet
    })
  }

  const toggleDonationsExpansion = (type: 'received' | 'given') => {
    setExpandedDonations(prev => prev === type ? null : type)
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        {/* Date Range Tabs */}
        <div className="flex space-x-1 mb-6">
          {dateRanges.map((range) => (
            <button
              key={range.value}
              onClick={() => setSelectedRange(range.value)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                selectedRange === range.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {reportData && (
        <div className="space-y-8">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Revenue</h3>
              <p className="text-3xl font-bold text-green-600">
                {formatCurrency(
                  reportData.summary.memberships.reduce((sum, m) => sum + m.totalAmount, 0) +
                  reportData.summary.registrations.totalAmount +
                  reportData.summary.donationsReceived.totalAmount
                )}
              </p>
            </div>
            
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Memberships</h3>
              <p className="text-3xl font-bold text-blue-600">
                {reportData.summary.memberships.reduce((sum, m) => sum + m.purchaseCount, 0)}
              </p>
            </div>
            
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Registrations</h3>
              <p className="text-3xl font-bold text-purple-600">
                {reportData.summary.registrations.purchaseCount}
              </p>
            </div>
            
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Donations</h3>
              <p className="text-3xl font-bold text-orange-600">
                {formatCurrency(reportData.summary.donationsReceived.totalAmount)}
              </p>
            </div>
          </div>

          {/* Detailed Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Memberships */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Memberships</h2>
              </div>
              <div className="p-6">
                {/* Summary totals */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <p className="font-medium text-gray-900">Total Memberships</p>
                    <p className="text-sm text-gray-500">{reportData.summary.memberships.reduce((sum, m) => sum + m.purchaseCount, 0)} purchases</p>
                  </div>
                  <p className="font-semibold text-blue-600">{formatCurrency(reportData.summary.memberships.reduce((sum, m) => sum + m.totalAmount, 0))}</p>
                </div>
                {reportData.summary.memberships.length > 0 ? (
                  <div className="space-y-4">
                    {reportData.summary.membershipsBreakdown && reportData.summary.membershipsBreakdown.length > 0 ? (
                      reportData.summary.membershipsBreakdown.map((membership) => {
                        const isExpanded = expandedMemberships.has(membership.membershipId)
                        return (
                          <div key={membership.membershipId} className="border rounded-lg p-4">
                            <div 
                              className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                              onClick={() => toggleMembershipExpansion(membership.membershipId)}
                            >
                              <div className="flex items-center">
                                <button className="mr-2 text-gray-500 hover:text-gray-700">
                                  {isExpanded ? '▼' : '▶'}
                                </button>
                                <h4 className="font-medium text-gray-900">{membership.name}</h4>
                              </div>
                              <div className="text-right">
                                <div className="text-lg font-semibold text-blue-600">
                                  {formatCurrency(membership.total)}
                                </div>
                                <div className="text-sm text-gray-600">
                                  {membership.count} purchase{membership.count !== 1 ? 's' : ''}
                                </div>
                              </div>
                            </div>
                            
                            {/* Individual memberships - only show when expanded */}
                            {isExpanded && (
                              <div className="space-y-2 mt-4">
                                {membership.memberships.map((mem) => (
                                  <div key={mem.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded">
                                    <div>
                                      <span className="font-medium">{mem.customerName}</span>
                                      <span className="text-gray-500 ml-2">
                                        {formatDate(mem.date)}
                                      </span>
                                    </div>
                                    <div className="font-medium text-gray-900">
                                      {formatCurrency(mem.amount)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      // Fallback to simple list if breakdown not available
                      reportData.summary.memberships.map((membership, index) => (
                        <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                          <div>
                            <p className="font-medium text-gray-900">{membership.name}</p>
                            <p className="text-sm text-gray-500">{membership.purchaseCount} purchases</p>
                          </div>
                          <p className="font-semibold text-gray-900">{formatCurrency(membership.totalAmount)}</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No membership purchases in this period</p>
                )}
              </div>
            </div>

            {/* Discount Usage */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Discount Usage</h2>
              </div>
              <div className="p-6">
                {/* Summary totals */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <p className="font-medium text-gray-900">Total Discount Usage</p>
                    <p className="text-sm text-gray-500">{reportData.summary.discountUsage.reduce((sum, d) => sum + d.timesUsed, 0)} uses</p>
                  </div>
                  <p className="font-semibold text-green-600">{formatCurrency(reportData.summary.discountUsage.reduce((sum, d) => sum + d.totalAmount, 0))}</p>
                </div>
                {reportData.summary.discountUsage.length > 0 ? (
                  <div className="space-y-4">
                    {reportData.summary.discountUsageBreakdown && reportData.summary.discountUsageBreakdown.length > 0 ? (
                      reportData.summary.discountUsageBreakdown.map((category) => {
                        const isExpanded = expandedDiscountCategories.has(category.categoryId)
                        return (
                          <div key={category.categoryId} className="border rounded-lg p-4">
                            <div 
                              className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                              onClick={() => toggleDiscountCategoryExpansion(category.categoryId)}
                            >
                              <div className="flex items-center">
                                <button className="mr-2 text-gray-500 hover:text-gray-700">
                                  {isExpanded ? '▼' : '▶'}
                                </button>
                                <h4 className="font-medium text-gray-900">{category.name}</h4>
                              </div>
                              <div className="text-right">
                                <div className="text-lg font-semibold text-green-600">
                                  {formatCurrency(category.total)}
                                </div>
                                <div className="text-sm text-gray-600">
                                  {category.count} time{category.count !== 1 ? 's' : ''} used
                                </div>
                              </div>
                            </div>
                            
                            {/* Individual usages - only show when expanded */}
                            {isExpanded && (
                              <div className="space-y-2 mt-4">
                                {category.usages.map((usage) => (
                                  <div key={usage.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded">
                                    <div>
                                      <span className="font-medium">{usage.customerName}</span>
                                      <span className="text-gray-500 ml-2">
                                        {usage.discountCode} - {formatDate(usage.date)}
                                      </span>
                                    </div>
                                    <div className="font-medium text-green-600">
                                      -{formatCurrency(usage.amountSaved)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      // Fallback to simple list if breakdown not available
                      reportData.summary.discountUsage.map((discount, index) => (
                        <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                          <div>
                            <p className="font-medium text-gray-900">{discount.category}</p>
                            <p className="text-sm text-gray-500">{discount.timesUsed} times used</p>
                          </div>
                          <p className="font-semibold text-gray-900">{formatCurrency(discount.totalAmount)}</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No discount usage in this period</p>
                )}
              </div>
            </div>

            {/* Donations */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Donations</h2>
              </div>
              <div className="p-6">
                {/* Summary totals */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <p className="font-medium text-gray-900">Net Donations</p>
                    <p className="text-sm text-gray-500">{reportData.summary.donationsReceived.transactionCount + reportData.summary.donationsGiven.transactionCount} transactions</p>
                  </div>
                  <p className="font-semibold text-green-600">{formatCurrency(reportData.summary.donationsReceived.totalAmount - reportData.summary.donationsGiven.totalAmount)}</p>
                </div>
                
                <div className="space-y-4">
                  {/* Donations Received - only show if there are transactions */}
                  {reportData.summary.donationsReceived.transactionCount > 0 && (
                    <div className="border rounded-lg p-4">
                      <div 
                        className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                        onClick={() => toggleDonationsExpansion('received')}
                      >
                        <div className="flex items-center">
                          <button className="mr-2 text-gray-500 hover:text-gray-700">
                            {expandedDonations === 'received' ? '▼' : '▶'}
                          </button>
                          <h4 className="font-medium text-gray-900">Donations Received</h4>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-green-600">
                            {formatCurrency(reportData.summary.donationsReceived.totalAmount)}
                          </div>
                          <div className="text-sm text-gray-600">
                            {reportData.summary.donationsReceived.transactionCount} transaction{reportData.summary.donationsReceived.transactionCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      
                      {/* Individual donations received - only show when expanded */}
                      {expandedDonations === 'received' && (
                        <div className="space-y-2 mt-4">
                          {reportData.summary.donationDetails?.filter(d => d.type === 'received').map((donation) => (
                            <div key={donation.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded">
                              <div>
                                <span className="font-medium">{donation.customerName}</span>
                                <span className="text-gray-500 ml-2">
                                  {formatDate(donation.date)}
                                </span>
                              </div>
                              <div className="font-medium text-green-600">
                                {formatCurrency(donation.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Donations Given - only show if there are transactions */}
                  {reportData.summary.donationsGiven.transactionCount > 0 && (
                    <div className="border rounded-lg p-4">
                      <div 
                        className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                        onClick={() => toggleDonationsExpansion('given')}
                      >
                        <div className="flex items-center">
                          <button className="mr-2 text-gray-500 hover:text-gray-700">
                            {expandedDonations === 'given' ? '▼' : '▶'}
                          </button>
                          <h4 className="font-medium text-gray-900">Donations Given</h4>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-orange-600">
                            {formatCurrency(reportData.summary.donationsGiven.totalAmount)}
                          </div>
                          <div className="text-sm text-gray-600">
                            {reportData.summary.donationsGiven.transactionCount} transaction{reportData.summary.donationsGiven.transactionCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      
                      {/* Individual donations given - only show when expanded */}
                      {expandedDonations === 'given' && (
                        <div className="space-y-2 mt-4">
                          {reportData.summary.donationDetails?.filter(d => d.type === 'given').map((donation) => (
                            <div key={donation.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded">
                              <div>
                                <span className="font-medium">{donation.customerName}</span>
                                <span className="text-gray-500 ml-2">
                                  {formatDate(donation.date)}
                                </span>
                              </div>
                              <div className="font-medium text-orange-600">
                                {formatCurrency(donation.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show message if no donations at all */}
                  {reportData.summary.donationsReceived.transactionCount === 0 && reportData.summary.donationsGiven.transactionCount === 0 && (
                    <div className="text-center text-gray-500 text-sm py-4">
                      No donation transactions in this period
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Registrations */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Registrations</h2>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <p className="font-medium text-gray-900">Total Registrations</p>
                    <p className="text-sm text-gray-500">{reportData.summary.registrations.purchaseCount} purchases</p>
                  </div>
                  <p className="font-semibold text-purple-600">{formatCurrency(reportData.summary.registrations.totalAmount)}</p>
                </div>
                
                {/* Registrations Breakdown */}
                {reportData.summary.registrations.breakdown && reportData.summary.registrations.breakdown.length > 0 && (
                  <div className="space-y-4">
                    {reportData.summary.registrations.breakdown.map((registration) => {
                      const isExpanded = expandedRegistrations.has(registration.registrationId)
                      return (
                        <div key={registration.registrationId} className="border rounded-lg p-4">
                          <div 
                            className="flex justify-between items-center mb-3 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                            onClick={() => toggleRegistrationExpansion(registration.registrationId)}
                          >
                            <div className="flex items-center">
                              <button className="mr-2 text-gray-500 hover:text-gray-700">
                                {isExpanded ? '▼' : '▶'}
                              </button>
                              <h4 className="font-medium text-gray-900">{registration.name}</h4>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-semibold text-purple-600">
                                {formatCurrency(registration.total)}
                              </div>
                              <div className="text-sm text-gray-600">
                                {registration.count} purchase{registration.count !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          
                          {/* Individual registrations - only show when expanded */}
                          {isExpanded && (
                            <div className="space-y-2 mt-4">
                              {registration.registrations.map((reg) => (
                                <div key={reg.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded">
                                  <div>
                                    <span className="font-medium">{reg.customerName}</span>
                                    <span className="text-gray-500 ml-2">
                                      {formatDate(reg.date)}
                                    </span>
                                  </div>
                                  <div className="font-medium text-gray-900">
                                    {formatCurrency(reg.amount)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Recent Transactions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData.recentTransactions.length > 0 ? (
                    reportData.recentTransactions.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {transaction.invoiceNumber || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {transaction.customerName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            transaction.type === 'membership' ? 'bg-blue-100 text-blue-800' :
                            transaction.type === 'registration' ? 'bg-purple-100 text-purple-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {transaction.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                          {formatCurrency(transaction.amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            transaction.status === 'AUTHORISED' ? 'bg-green-100 text-green-800' :
                            transaction.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {transaction.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(transaction.date)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                        No recent transactions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 