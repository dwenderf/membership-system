'use client'

import { useState, useEffect } from 'react'
import { formatDateTime } from '@/lib/date-utils'

interface DiscountCodeUsage {
  code: string
  codeId: string
  amount: number
  date: string
  registrationName: string | null
}

interface UserUsage {
  userId: string
  userName: string
  userEmail: string
  memberId: string | null
  totalAmount: number
  remaining: number | null
  isFullyUtilized: boolean
  discountCodes: DiscountCodeUsage[]
}

interface CategoryUsage {
  categoryId: string
  categoryName: string
  totalAmount: number
  maxPerUser: number | null
  users: UserUsage[]
}

interface SeasonUsage {
  seasonId: string
  seasonName: string
  startDate: string
  endDate: string
  totalAmount: number
  categories: CategoryUsage[]
}

interface ReportData {
  success: boolean
  seasons: SeasonUsage[]
}

export default function DiscountUsageReportPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchReportData()
  }, [])

  const fetchReportData = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/reports/discount-usage')
      if (!response.ok) {
        throw new Error('Failed to fetch discount usage data')
      }
      const data = await response.json()
      setReportData(data)
    } catch (err) {
      console.error('Error fetching discount usage data:', err)
      setError('Failed to load discount usage data')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount / 100)
  }

  const formatDate = (dateString: string) => {
    return formatDateTime(new Date(dateString))
  }

  const toggleSeasonExpansion = (seasonId: string) => {
    setExpandedSeasons(prev => {
      const newSet = new Set(prev)
      if (newSet.has(seasonId)) {
        newSet.delete(seasonId)
      } else {
        newSet.add(seasonId)
      }
      return newSet
    })
  }

  const toggleCategoryExpansion = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId)
      } else {
        newSet.add(categoryId)
      }
      return newSet
    })
  }

  const toggleUserExpansion = (userId: string) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(userId)) {
        newSet.delete(userId)
      } else {
        newSet.add(userId)
      }
      return newSet
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

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
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
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Discount Usage Report</h1>
        <p className="mt-2 text-gray-600">View discount usage grouped by season, category, and user</p>
      </div>

      {reportData && reportData.seasons.length > 0 ? (
        <div className="space-y-6">
          {/* Summary Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Discount Usage</h3>
            <p className="text-3xl font-bold text-blue-600">
              {formatCurrency(reportData.seasons.reduce((sum, season) => sum + season.totalAmount, 0))}
            </p>
            <p className="text-sm text-gray-500 mt-1">Across all seasons</p>
          </div>

          {/* Seasons */}
          {reportData.seasons.map(season => {
            const isSeasonExpanded = expandedSeasons.has(season.seasonId)
            return (
              <div key={season.seasonId} className="bg-white rounded-lg shadow">
                <div
                  className="px-6 py-4 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleSeasonExpansion(season.seasonId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <button className="mr-3 text-gray-500 hover:text-gray-700">
                        {isSeasonExpanded ? '▼' : '▶'}
                      </button>
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">{season.seasonName}</h2>
                        <p className="text-sm text-gray-500">
                          {formatDate(season.startDate)} - {formatDate(season.endDate)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">
                        {formatCurrency(season.totalAmount)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {season.categories.length} categor{season.categories.length === 1 ? 'y' : 'ies'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Categories within Season */}
                {isSeasonExpanded && (
                  <div className="p-6 space-y-4">
                    {season.categories.map(category => {
                      const isCategoryExpanded = expandedCategories.has(category.categoryId)
                      return (
                        <div key={category.categoryId} className="border rounded-lg">
                          <div
                            className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                            onClick={() => toggleCategoryExpansion(category.categoryId)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                <button className="mr-3 text-gray-500 hover:text-gray-700">
                                  {isCategoryExpanded ? '▼' : '▶'}
                                </button>
                                <div>
                                  <h3 className="text-lg font-medium text-gray-900">{category.categoryName}</h3>
                                  {category.maxPerUser && (
                                    <p className="text-sm text-gray-500">
                                      Cap: {formatCurrency(category.maxPerUser)} per user
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xl font-semibold text-purple-600">
                                  {formatCurrency(category.totalAmount)}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {category.users.length} user{category.users.length === 1 ? '' : 's'}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Users within Category */}
                          {isCategoryExpanded && (
                            <div className="px-4 pb-4 space-y-3">
                              {category.users.map(user => {
                                const isUserExpanded = expandedUsers.has(user.userId)
                                return (
                                  <div key={user.userId} className="border-l-4 border-blue-200 bg-gray-50 rounded">
                                    <div
                                      className="p-3 cursor-pointer hover:bg-gray-100 transition-colors"
                                      onClick={() => toggleUserExpansion(user.userId)}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center">
                                          <button className="mr-2 text-gray-500 hover:text-gray-700">
                                            {isUserExpanded ? '▼' : '▶'}
                                          </button>
                                          <div>
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium text-gray-900">{user.userName}</span>
                                              {user.memberId && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                  #{user.memberId}
                                                </span>
                                              )}
                                              {user.isFullyUtilized && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                                  Fully Utilized
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-sm text-gray-500">{user.userEmail}</div>
                                            {user.remaining !== null && (
                                              <div className="text-sm text-gray-600 mt-1">
                                                Remaining: {formatCurrency(user.remaining)}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-lg font-semibold text-green-600">
                                            {formatCurrency(user.totalAmount)}
                                          </div>
                                          <div className="text-xs text-gray-500">
                                            {user.discountCodes.length} code{user.discountCodes.length === 1 ? '' : 's'}
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Discount Codes for User */}
                                    {isUserExpanded && (
                                      <div className="px-3 pb-3 space-y-2">
                                        {user.discountCodes.map((codeUsage, index) => (
                                          <div key={`${codeUsage.codeId}-${index}`} className="bg-white p-3 rounded shadow-sm">
                                            <div className="flex justify-between items-center">
                                              <div>
                                                <div className="font-medium text-gray-900">{codeUsage.code}</div>
                                                <div className="text-sm text-gray-500">{formatDate(codeUsage.date)}</div>
                                                {codeUsage.registrationName && (
                                                  <div className="text-sm text-gray-500">{codeUsage.registrationName}</div>
                                                )}
                                              </div>
                                              <div className="text-right">
                                                <div className="font-semibold text-green-600">
                                                  {formatCurrency(codeUsage.amount)}
                                                </div>
                                              </div>
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
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
            <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Discount Usage Found</h3>
          <p className="text-gray-600">There is no discount usage data available yet.</p>
        </div>
      )}
    </div>
  )
}
