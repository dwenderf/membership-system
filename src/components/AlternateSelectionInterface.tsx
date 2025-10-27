'use client'

import { useState, useEffect } from 'react'
import { formatDate as formatDateUtil } from '@/lib/date-utils'


interface Alternate {
  id: string
  userId: string
  firstName: string
  lastName: string
  email: string
  registeredAt: string
  hasValidPaymentMethod: boolean
  isAlreadySelected: boolean
  discountCode?: {
    id: string
    code: string
    discountType: string
    discountValue: number
    discountAmount: number
    categoryName: string
    isOverLimit: boolean
    usageStatus?: {
      currentUsage: number
      limit: number
      wouldExceed: boolean
      remainingAmount: number
    }
  }
  pricing: {
    basePrice: number
    discountAmount: number
    finalAmount: number
  }
}

interface Game {
  id: string
  registrationId: string
  registrationName: string
  gameDescription: string
  gameDate: string
  alternatePrice: number
  alternateAccountingCode: string
}

interface AlternateSelectionInterfaceProps {
  gameId: string
  onSelectionComplete: (results: any) => void
  onCancel: () => void
}

export default function AlternateSelectionInterface({ 
  gameId, 
  onSelectionComplete, 
  onCancel 
}: AlternateSelectionInterfaceProps) {
  const [game, setGame] = useState<Game | null>(null)
  const [alternates, setAlternates] = useState<Alternate[]>([])
  const [selectedAlternates, setSelectedAlternates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<any>(null)

  useEffect(() => {
    fetchAlternates()
  }, [gameId])

  const fetchAlternates = async () => {
    try {
      const response = await fetch(`/api/alternate-registrations/${gameId}/alternates`)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch alternates')
      }

      const data = await response.json()
      setGame(data.game)
      setAlternates(data.alternates)
      setSummary(data.summary)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alternates')
    } finally {
      setLoading(false)
    }
  }

  const handleAlternateToggle = (alternateId: string) => {
    setSelectedAlternates(prev => {
      const newSet = new Set(prev)
      if (newSet.has(alternateId)) {
        newSet.delete(alternateId)
      } else {
        newSet.add(alternateId)
      }
      return newSet
    })
  }

  const handleSelectAll = () => {
    const availableAlternates = alternates.filter(alt => 
      !alt.isAlreadySelected && alt.hasValidPaymentMethod
    )
    setSelectedAlternates(new Set(availableAlternates.map(alt => alt.id)))
  }

  const handleClearAll = () => {
    setSelectedAlternates(new Set())
  }

  const calculateTotals = () => {
    const selectedAlternatesList = alternates.filter(alt => selectedAlternates.has(alt.id))
    
    return {
      count: selectedAlternatesList.length,
      totalAmount: selectedAlternatesList.reduce((sum, alt) => sum + alt.pricing.finalAmount, 0),
      withDiscounts: selectedAlternatesList.filter(alt => alt.discountCode).length,
      overLimitWarnings: selectedAlternatesList.filter(alt => alt.discountCode?.isOverLimit).length
    }
  }

  const handleProcessSelections = async () => {
    if (selectedAlternates.size === 0) {
      setError('Please select at least one alternate')
      return
    }

    setProcessing(true)
    setError('')

    try {
      const selectedAlternatesList = alternates.filter(alt => selectedAlternates.has(alt.id))
      
      const response = await fetch(`/api/alternate-registrations/${gameId}/select`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          alternateIds: Array.from(selectedAlternates)
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process selections')
      }

      onSelectionComplete(data)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process selections')
    } finally {
      setProcessing(false)
    }
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  const formatDate = (dateString: string) => {
    return formatDateUtil(new Date(dateString))
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="text-center">
          <div className="text-gray-500">Loading alternates...</div>
        </div>
      </div>
    )
  }

  if (error && !game) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  const totals = calculateTotals()

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Select Alternates
            </h2>
            <p className="text-gray-600 mt-1">
              {game?.gameDescription} • {game && formatCurrency(game.alternatePrice)} per alternate
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">Total:</span>
              <div className="text-gray-900">{summary.totalAlternates}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">Available:</span>
              <div className="text-green-600">{summary.availableAlternates}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">Already Selected:</span>
              <div className="text-blue-600">{summary.alreadySelected}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">Valid Payment:</span>
              <div className="text-gray-900">{summary.withValidPayment}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">With Discounts:</span>
              <div className="text-purple-600">{summary.withDiscounts}</div>
            </div>
          </div>
        </div>
      )}

      {/* Selection Controls */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex space-x-2">
            <button
              onClick={handleSelectAll}
              className="text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200"
            >
              Select All Available
            </button>
            <button
              onClick={handleClearAll}
              className="text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded hover:bg-gray-200"
            >
              Clear All
            </button>
          </div>
          
          {totals.count > 0 && (
            <div className="text-sm text-gray-600">
              Selected: {totals.count} • Total: {formatCurrency(totals.totalAmount)}
              {totals.overLimitWarnings > 0 && (
                <span className="text-orange-600 ml-2">
                  ⚠️ {totals.overLimitWarnings} over limit
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Alternates List */}
      <div className="max-h-96 overflow-y-auto">
        {alternates.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No alternates registered for this registration.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {alternates.map((alternate) => (
              <div
                key={alternate.id}
                className={`px-6 py-4 ${
                  alternate.isAlreadySelected 
                    ? 'bg-blue-50' 
                    : !alternate.hasValidPaymentMethod 
                    ? 'bg-gray-50' 
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={selectedAlternates.has(alternate.id)}
                      onChange={() => handleAlternateToggle(alternate.id)}
                      disabled={alternate.isAlreadySelected || !alternate.hasValidPaymentMethod || processing}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                    />
                    
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">
                          {alternate.firstName} {alternate.lastName}
                        </span>
                        
                        {alternate.isAlreadySelected && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            Already Selected
                          </span>
                        )}
                        
                        {!alternate.hasValidPaymentMethod && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            No Payment Method
                          </span>
                        )}
                        
                        {alternate.discountCode && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            alternate.discountCode.isOverLimit 
                              ? 'bg-orange-100 text-orange-800' 
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {alternate.discountCode.code}
                            {alternate.discountCode.isOverLimit && ' ⚠️'}
                          </span>
                        )}
                      </div>
                      
                      <div className="text-sm text-gray-500">
                        {alternate.email} • Registered {formatDate(alternate.registeredAt)}
                      </div>
                      
                      {alternate.discountCode?.isOverLimit && alternate.discountCode.usageStatus && (
                        <div className="text-xs text-orange-600 mt-1">
                          Would exceed limit: ${alternate.discountCode.usageStatus.currentUsage/100} + ${alternate.discountCode.discountAmount/100} &gt; ${alternate.discountCode.usageStatus.limit/100}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="font-medium text-gray-900">
                      {formatCurrency(alternate.pricing.finalAmount)}
                    </div>
                    {alternate.discountCode && (
                      <div className="text-xs text-gray-500">
                        {formatCurrency(alternate.pricing.basePrice)} - {formatCurrency(alternate.pricing.discountAmount)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}
        
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {totals.count > 0 ? (
              <>
                {totals.count} selected • Total: {formatCurrency(totals.totalAmount)}
                {totals.overLimitWarnings > 0 && (
                  <div className="text-orange-600 mt-1">
                    ⚠️ {totals.overLimitWarnings} selection(s) will exceed discount limits
                  </div>
                )}
              </>
            ) : (
              'No alternates selected'
            )}
          </div>
          
          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              disabled={processing}
              className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:bg-gray-400"
            >
              Cancel
            </button>
            
            <button
              onClick={handleProcessSelections}
              disabled={processing || totals.count === 0}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {processing ? 'Processing...' : `Select ${totals.count} Alternate${totals.count !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}