'use client'

import { useState, useEffect } from 'react'

interface DiscountCategory {
  categoryName: string
  categoryId: string
  totalAmount: number
}

interface SeasonUsage {
  seasonName: string
  categories: DiscountCategory[]
  totalAmount: number
}

interface DiscountUsageData {
  success: boolean
  userId: string
  isAdmin: boolean
  discountUsage: SeasonUsage[]
}

interface DiscountUsageProps {
  userId?: string // Optional - for admin viewing other users
}

export default function DiscountUsage({ userId }: DiscountUsageProps) {
  const [data, setData] = useState<DiscountUsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const url = userId ? `/api/user-discount-usage?userId=${userId}` : '/api/user-discount-usage'
        const response = await fetch(url)
        
        if (response.ok) {
          const result = await response.json()
          setData(result)
        } else {
          const errorData = await response.json()
          setError(errorData.error || 'Failed to fetch discount usage')
        }
      } catch (err) {
        setError('Error loading discount usage')
        console.error('Error fetching discount usage:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchUsage()
  }, [userId])

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Discount Usage</h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Discount Usage</h3>
        <div className="text-red-600 text-sm">{error}</div>
      </div>
    )
  }

  if (!data?.discountUsage || data.discountUsage.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Discount Usage</h3>
        <div className="text-gray-500 text-sm">No recent discount usage.</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Discount Usage</h3>
      
      <div className="space-y-4">
        {data.discountUsage.map((season) => (
          <div key={season.seasonName} className="border-l-4 border-blue-500 pl-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium text-gray-900">{season.seasonName}</h4>
              <span className="text-sm font-semibold text-gray-700">
                ${(season.totalAmount / 100).toFixed(2)}
              </span>
            </div>
            
            <div className="space-y-1 ml-4">
              {season.categories.map((category) => (
                <div key={category.categoryId} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">{category.categoryName}</span>
                  <span className="text-gray-700 font-medium">
                    ${(category.totalAmount / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Total across all seasons */}
      {data.discountUsage.length > 1 && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-gray-900">Total Discount Usage</span>
            <span className="font-semibold text-blue-600">
              ${(data.discountUsage.reduce((sum, season) => sum + season.totalAmount, 0) / 100).toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}