'use client'

import { useState } from 'react'

interface Membership {
  id: string
  name: string
  description?: string
  price_monthly: number
  price_annual: number
}

interface MembershipPurchaseProps {
  membership: Membership
  userMemberships?: Array<{
    valid_until: string
    membership?: {
      id: string
    }
  }>
}

const DURATION_OPTIONS = [
  { months: 3, label: '3 Months' },
  { months: 6, label: '6 Months' },
  { months: 12, label: '12 Months (Annual)' },
]

export default function MembershipPurchase({ membership, userMemberships = [] }: MembershipPurchaseProps) {
  const [selectedDuration, setSelectedDuration] = useState(6) // Default to 6 months
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)

  const calculatePrice = (months: number) => {
    if (months === 12) {
      return membership.price_annual
    }
    return membership.price_monthly * months
  }

  const calculateSavings = (months: number) => {
    const regularPrice = membership.price_monthly * months
    const actualPrice = calculatePrice(months)
    return regularPrice - actualPrice
  }

  const selectedPrice = calculatePrice(selectedDuration)
  const savings = calculateSavings(selectedDuration)
  
  // Calculate validity period - start from latest expiration date of current memberships of same type, or today
  const getStartDate = () => {
    const currentMembershipsOfSameType = userMemberships.filter(
      um => um.membership?.id === membership.id && new Date(um.valid_until) > new Date()
    )
    
    if (currentMembershipsOfSameType.length > 0) {
      // Find the latest expiration date
      const latestExpiration = currentMembershipsOfSameType.reduce((latest, current) => {
        return new Date(current.valid_until) > new Date(latest.valid_until) ? current : latest
      })
      return new Date(latestExpiration.valid_until)
    }
    
    // No current membership of this type, start today
    return new Date()
  }
  
  const startDate = getStartDate()
  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + selectedDuration)
  
  const isExtension = startDate > new Date()

  const handlePurchase = () => {
    // For now, just show an alert - will integrate with Stripe later
    alert(`Purchase initiated for ${membership.name} - ${selectedDuration} months for $${(selectedPrice / 100).toFixed(2)}`)
  }

  return (
    <div className="mt-4">
      {/* Duration Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Duration
        </label>
        <div className="grid grid-cols-1 gap-2">
          {DURATION_OPTIONS.map((option) => {
            const price = calculatePrice(option.months)
            const optionSavings = calculateSavings(option.months)
            
            return (
              <label
                key={option.months}
                className={`relative flex cursor-pointer rounded-lg border p-3 focus:outline-none ${
                  selectedDuration === option.months
                    ? 'border-blue-600 ring-2 ring-blue-600 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <input
                  type="radio"
                  name="duration"
                  value={option.months}
                  checked={selectedDuration === option.months}
                  onChange={(e) => setSelectedDuration(Number(e.target.value))}
                  className="sr-only"
                />
                <div className="flex w-full justify-between">
                  <div className="flex items-center">
                    <div className="text-sm">
                      <div className={`font-medium ${
                        selectedDuration === option.months ? 'text-blue-900' : 'text-gray-900'
                      }`}>
                        {option.label}
                      </div>
                      {optionSavings > 0 && (
                        <div className="text-green-600 text-xs">
                          Save ${(optionSavings / 100).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`text-sm font-medium ${
                    selectedDuration === option.months ? 'text-blue-900' : 'text-gray-900'
                  }`}>
                    ${(price / 100).toFixed(2)}
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Purchase Summary */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">Purchase Summary</h4>
        {isExtension && (
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
            This will extend your current membership (no gap or overlap)
          </div>
        )}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Membership:</span>
            <span className="text-gray-900">{membership.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Duration:</span>
            <span className="text-gray-900">{selectedDuration} months</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">{isExtension ? 'Extends from:' : 'Valid from:'}:</span>
            <span className="text-gray-900">{startDate.toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Valid until:</span>
            <span className="text-gray-900">{endDate.toLocaleDateString()}</span>
          </div>
          {savings > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Savings:</span>
              <span>${(savings / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 font-medium">
            <span className="text-gray-900">Total:</span>
            <span className="text-gray-900">${(selectedPrice / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
      >
        Purchase Membership
      </button>
    </div>
  )
}