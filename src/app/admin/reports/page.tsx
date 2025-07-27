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
    donationsReceived: {
      transactionCount: number
      totalAmount: number
    }
    donationsGiven: {
      transactionCount: number
      totalAmount: number
    }
    memberships: Array<{
      name: string
      purchaseCount: number
      totalAmount: number
    }>
    registrations: {
      purchaseCount: number
      totalAmount: number
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
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Last 90 Days', value: '90d' }
]

export default function ReportsPage() {
  const [selectedRange, setSelectedRange] = useState('7d')
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
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
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Business Reports</h1>
        
        {/* Date Range Selector */}
        <div className="flex items-center space-x-4 mb-6">
          <label className="text-sm font-medium text-gray-700">Date Range:</label>
          <select
            value={selectedRange}
            onChange={(e) => setSelectedRange(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {dateRanges.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
          
          {reportData && (
            <span className="text-sm text-gray-500">
              {formatDate(reportData.dateRange.start)} - {formatDate(reportData.dateRange.end)}
            </span>
          )}
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
                  reportData.summary.registrations.totalAmount
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
            {/* Memberships by Type */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Memberships by Type</h2>
              </div>
              <div className="p-6">
                {reportData.summary.memberships.length > 0 ? (
                  <div className="space-y-4">
                    {reportData.summary.memberships.map((membership, index) => (
                      <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                        <div>
                          <p className="font-medium text-gray-900">{membership.name}</p>
                          <p className="text-sm text-gray-500">{membership.purchaseCount} purchases</p>
                        </div>
                        <p className="font-semibold text-gray-900">{formatCurrency(membership.totalAmount)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No membership purchases in this period</p>
                )}
              </div>
            </div>

            {/* Discount Usage */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Discount Usage by Category</h2>
              </div>
              <div className="p-6">
                {reportData.summary.discountUsage.length > 0 ? (
                  <div className="space-y-4">
                    {reportData.summary.discountUsage.map((discount, index) => (
                      <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                        <div>
                          <p className="font-medium text-gray-900">{discount.category}</p>
                          <p className="text-sm text-gray-500">{discount.timesUsed} times used</p>
                        </div>
                        <p className="font-semibold text-gray-900">{formatCurrency(discount.totalAmount)}</p>
                      </div>
                    ))}
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
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <div>
                    <p className="font-medium text-gray-900">Donations Received</p>
                    <p className="text-sm text-gray-500">{reportData.summary.donationsReceived.transactionCount} transactions</p>
                  </div>
                  <p className="font-semibold text-green-600">{formatCurrency(reportData.summary.donationsReceived.totalAmount)}</p>
                </div>
                <div className="flex justify-between items-center py-2">
                  <div>
                    <p className="font-medium text-gray-900">Donations Given</p>
                    <p className="text-sm text-gray-500">{reportData.summary.donationsGiven.transactionCount} transactions</p>
                  </div>
                  <p className="font-semibold text-orange-600">{formatCurrency(reportData.summary.donationsGiven.totalAmount)}</p>
                </div>
              </div>
            </div>

            {/* Registrations */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Registrations</h2>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-900">Total Registrations</p>
                    <p className="text-sm text-gray-500">{reportData.summary.registrations.purchaseCount} purchases</p>
                  </div>
                  <p className="font-semibold text-purple-600">{formatCurrency(reportData.summary.registrations.totalAmount)}</p>
                </div>
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