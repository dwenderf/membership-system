'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatAmount } from '@/lib/format-utils'
import { formatDate } from '@/lib/date-utils'
import { filterActivePlans } from '@/lib/payment-plan-utils'

interface PaymentPlan {
  id: string
  registrationName: string
  seasonName: string
  totalAmount: number
  paidAmount: number
  remainingBalance: number
  installmentAmount: number
  installmentsCount: number
  installmentsPaid: number
  nextPaymentDate: string | null
  status: string
  createdAt: string
}

interface User {
  userId: string
  email: string
  firstName: string
  lastName: string
  paymentPlanEnabled: boolean
  activePlansCount: number
  totalPlansCount: number
  totalAmount: number
  paidAmount: number
  remainingBalance: number
  nextPaymentDate: string | null
  finalPaymentDate: string | null
  plans: PaymentPlan[]
}

interface PaymentPlansTableProps {
  initialData: User[]
}

export default function PaymentPlansTable({ initialData }: PaymentPlansTableProps) {
  const [filter, setFilter] = useState<'all' | 'eligible' | 'active'>('all')
  const [users, setUsers] = useState<User[]>(initialData)
  const [loading, setLoading] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [processingResult, setProcessingResult] = useState<{
    success: boolean
    message: string
    results?: any
  } | null>(null)

  useEffect(() => {
    fetchData()
  }, [filter])

  const fetchData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/payment-plans?filter=${filter}`)
      const data = await response.json()
      if (response.ok) {
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Error fetching payment plans:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleRow = (userId: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId)
    } else {
      newExpanded.add(userId)
    }
    setExpandedRows(newExpanded)
  }

  const handleRunPayments = async () => {
    setProcessing(true)
    setProcessingResult(null)

    try {
      const response = await fetch('/api/admin/payment-plans/run-payments', {
        method: 'POST'
      })
      const data = await response.json()

      setProcessingResult(data)

      // Refresh the data after processing
      if (data.success) {
        await fetchData()
      }
    } catch (error) {
      setProcessingResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      {/* Filters and Actions */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700">Filter:</span>
            <div className="flex space-x-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                All Users
              </button>
              <button
                onClick={() => setFilter('eligible')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  filter === 'eligible'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                Eligible Only
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  filter === 'active'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                With Balance Due
              </button>
            </div>
          </div>

          {/* Run Payments Button */}
          <button
            onClick={handleRunPayments}
            disabled={processing}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              processing
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {processing ? 'Processing...' : 'Run Payments'}
          </button>
        </div>

        {/* Processing Results */}
        {processingResult && (
          <div className={`mt-4 p-4 rounded ${
            processingResult.success
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}>
            <div className={`text-sm font-medium ${
              processingResult.success ? 'text-green-800' : 'text-red-800'
            }`}>
              {processingResult.message}
            </div>
            {processingResult.results && (
              <div className="mt-2 text-xs space-y-1">
                <div className="text-gray-700">
                  Payments found: <span className="font-medium">{processingResult.results.paymentsFound}</span>
                </div>
                <div className="text-green-700">
                  Processed successfully: <span className="font-medium">{processingResult.results.paymentsProcessed}</span>
                </div>
                {processingResult.results.paymentsFailed > 0 && (
                  <div className="text-red-700">
                    Failed: <span className="font-medium">{processingResult.results.paymentsFailed}</span>
                  </div>
                )}
                {processingResult.results.retriesAttempted > 0 && (
                  <div className="text-orange-700">
                    Retries attempted: <span className="font-medium">{processingResult.results.retriesAttempted}</span>
                  </div>
                )}
                {processingResult.results.completionEmailsSent > 0 && (
                  <div className="text-purple-700">
                    Completion emails sent: <span className="font-medium">{processingResult.results.completionEmailsSent}</span>
                  </div>
                )}
                {processingResult.results.errors && processingResult.results.errors.length > 0 && (
                  <div className="mt-2 text-red-700">
                    <div className="font-medium">Errors:</div>
                    <ul className="list-disc list-inside mt-1">
                      {processingResult.results.errors.map((error: string, idx: number) => (
                        <li key={idx}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="px-6 py-8 text-center text-gray-500">Loading...</div>
        ) : users.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">No users found</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Eligibility
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Active Plans
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Paid
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Remaining
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Payment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <>
                  <tr key={user.userId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.paymentPlanEnabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {user.paymentPlanEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.activePlansCount > 0 ? (
                        <button
                          onClick={() => toggleRow(user.userId)}
                          className="text-blue-600 hover:text-blue-900 font-medium"
                        >
                          {user.activePlansCount} {user.activePlansCount === 1 ? 'plan' : 'plans'}
                          <span className="ml-1">{expandedRows.has(user.userId) ? '▼' : '▶'}</span>
                        </button>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.totalAmount > 0 ? formatAmount(user.totalAmount) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                      {user.paidAmount > 0 ? formatAmount(user.paidAmount) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {user.remainingBalance > 0 ? (
                        <span className="font-medium text-orange-600">
                          {formatAmount(user.remainingBalance)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.nextPaymentDate ? formatDate(new Date(user.nextPaymentDate)) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <Link
                        href={`/admin/reports/users/${user.userId}?from=payment-plans`}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>

                  {/* Expanded row showing individual plans */}
                  {expandedRows.has(user.userId) && user.plans.length > 0 && (
                    <tr key={`${user.userId}-details`}>
                      <td colSpan={8} className="px-6 py-4 bg-gray-50">
                        <div className="space-y-3">
                          {filterActivePlans(user.plans).map((plan) => (
                            <div key={plan.id} className="bg-white rounded border border-gray-200 p-4">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <h4 className="text-sm font-medium text-gray-900">
                                    {plan.registrationName}
                                  </h4>
                                  {plan.seasonName && (
                                    <p className="text-xs text-gray-500">{plan.seasonName}</p>
                                  )}
                                </div>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  plan.status === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : plan.status === 'completed'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}>
                                  {plan.status}
                                </span>
                              </div>
                              <div className="grid grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-gray-500">Total:</span>
                                  <span className="ml-1 font-medium">{formatAmount(plan.totalAmount)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Paid:</span>
                                  <span className="ml-1 font-medium text-green-600">{formatAmount(plan.paidAmount)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Remaining:</span>
                                  <span className="ml-1 font-medium text-orange-600">{formatAmount(plan.remainingBalance)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Progress:</span>
                                  <span className="ml-1 font-medium">{plan.installmentsPaid}/{plan.installmentsCount}</span>
                                </div>
                              </div>
                              {plan.nextPaymentDate && (
                                <div className="mt-2 pt-2 border-t border-gray-100 text-xs">
                                  <span className="text-gray-500">Next Payment:</span>
                                  <span className="ml-1 font-medium">{formatDate(new Date(plan.nextPaymentDate))}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
