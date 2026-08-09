'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import BreadcrumbNav from '@/components/BreadcrumbNav'
import SeasonSelector from '@/components/SeasonSelector'
import { formatAmount } from '@/lib/format-utils'
import { formatDate } from '@/lib/date-utils'

interface Season {
  id: string
  name: string
  start_date: string
  end_date: string
}

interface EligibilityRow {
  allowanceId: string
  userId: string
  userName: string
  userEmail: string
  memberId: string | null
  categoryId: string
  categoryName: string
  discountPercentage: number
  maxDiscountAmount: number | null
  effectiveMaxAllowed: number | null
  totalUsed: number
  remaining: number | null
  isRevoked: boolean
  source: 'user_allowance' | 'denied'
  notes: string | null
  updatedAt: string
}

export default function DiscountEligibilityReportPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('')
  const [eligibility, setEligibility] = useState<EligibilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReport(selectedSeasonId)
  }, [selectedSeasonId])

  const fetchReport = async (seasonId?: string) => {
    setLoading(true)
    setError(null)

    try {
      const url = seasonId
        ? `/api/admin/reports/discount-eligibility?seasonId=${seasonId}`
        : '/api/admin/reports/discount-eligibility'

      const res = await fetch(url)
      const data = await res.json()

      if (res.ok) {
        setSeasons(data.seasons || [])
        setSelectedSeasonId(data.selectedSeasonId || '')
        setEligibility(data.eligibility || [])
      } else {
        setError(data.error || 'Failed to fetch eligibility report')
      }
    } catch (err) {
      setError('Error loading discount eligibility report')
      console.error('Error fetching discount eligibility report:', err)
    } finally {
      setLoading(false)
    }
  }

  const seasonSummaries = useMemo(
    () => seasons.map(s => ({ id: s.id, name: s.name, startDate: s.start_date, endDate: s.end_date })),
    [seasons]
  )

  // Summary Metrics
  const activeRows = eligibility.filter(r => !r.isRevoked)
  const totalEligibleUsers = activeRows.length
  const totalUsedCents = eligibility.reduce((sum, r) => sum + r.totalUsed, 0)

  const breadcrumbs = [
    { label: 'Admin Dashboard', path: '/admin' },
    { label: 'Discount Eligibility', path: '/admin/reports/discount-eligibility' }
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <BreadcrumbNav breadcrumbs={breadcrumbs} position="top" />

          {/* Page Header */}
          <div className="mb-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Discount Eligibility Report</h1>
              <p className="mt-1 text-sm text-gray-600">
                View all per-user seasonal discount allowances, cap resolution, and remaining balances
              </p>
            </div>

            {/* Season Filter */}
            {seasons.length > 0 && (
              <SeasonSelector
                seasons={seasonSummaries}
                selectedSeasonId={selectedSeasonId}
                onSelect={setSelectedSeasonId}
              />
            )}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
              <span className="text-xs font-medium text-gray-500 block">Eligible Allowance Holders</span>
              <span className="text-2xl font-bold text-gray-900">{totalEligibleUsers}</span>
            </div>
            <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
              <span className="text-xs font-medium text-gray-500 block">Total Used</span>
              <span className="text-2xl font-bold text-blue-600">{formatAmount(totalUsedCents)}</span>
            </div>
            <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
              <span className="text-xs font-medium text-gray-500 block">Revoked / Ineligible</span>
              <span className="text-2xl font-bold text-red-600">
                {eligibility.length - totalEligibleUsers}
              </span>
            </div>
          </div>

          {/* Report Content */}
          {loading ? (
            <div className="bg-white p-8 rounded-lg shadow text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-500">Loading eligibility report...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg text-sm text-red-700">
              {error}
            </div>
          ) : eligibility.length === 0 ? (
            <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500 text-sm">
              No discount allowances found for this season.
            </div>
          ) : (
            <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Member
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Percentage
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Cap
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Used
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Remaining
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {eligibility.map((row) => (
                      <tr key={row.allowanceId} className={row.isRevoked ? 'bg-red-50/30' : undefined}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`/admin/reports/users/${row.userId}`}
                            className="font-medium text-blue-600 hover:text-blue-800"
                          >
                            {row.userName}
                          </Link>
                          <div className="text-xs text-gray-500">
                            {row.userEmail} {row.memberId ? `• #${row.memberId}` : ''}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                          {row.categoryName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {row.source === 'denied' || row.isRevoked ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              Revoked
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900 font-medium">
                          {row.discountPercentage}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                          {row.isRevoked ? (
                            <span className="text-gray-500">Revoked ($0.00)</span>
                          ) : row.maxDiscountAmount === null ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                              No dollar cap
                            </span>
                          ) : (
                            formatAmount(row.maxDiscountAmount)
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-blue-600 font-medium">
                          {formatAmount(row.totalUsed)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap font-medium">
                          {row.isRevoked ? (
                            <span className="text-red-600">Not eligible</span>
                          ) : row.remaining === null ? (
                            <span className="text-purple-600">Unlimited</span>
                          ) : (
                            <span className="text-green-600">{formatAmount(row.remaining)}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">
                          {row.notes || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <BreadcrumbNav breadcrumbs={breadcrumbs} position="bottom" />
        </div>
      </div>
    </div>
  )
}
