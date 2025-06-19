'use client'

import { useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe-client'
import PaymentForm from './PaymentForm'

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
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const handlePurchase = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          membershipId: membership.id,
          durationMonths: selectedDuration,
          amount: selectedPrice,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create payment intent')
      }

      const { clientSecret } = await response.json()
      setClientSecret(clientSecret)
      setShowPaymentForm(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
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

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-red-800 text-sm">{error}</div>
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={isLoading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
      >
        {isLoading ? 'Processing...' : 'Purchase Membership'}
      </button>

      {/* Payment Form Modal */}
      {showPaymentForm && clientSecret && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Complete Payment</h3>
              <button
                onClick={() => setShowPaymentForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total: <span className="font-medium text-gray-900">${(selectedPrice / 100).toFixed(2)}</span></div>
              <div className="text-sm text-gray-600">{membership.name} - {selectedDuration} months</div>
            </div>

            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <PaymentForm
                membershipId={membership.id}
                durationMonths={selectedDuration}
                amount={selectedPrice}
                startDate={startDate}
                endDate={endDate}
                onSuccess={() => {
                  setShowPaymentForm(false)
                  setClientSecret(null)
                  // Reset form state
                  setSelectedDuration(6) // Reset to default
                  setError(null)
                  // Scroll to top to show updated membership status
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                  // Refresh the page to show updated membership
                  setTimeout(() => window.location.reload(), 1000)
                }}
                onError={(error) => {
                  setError(error)
                  setShowPaymentForm(false)
                }}
              />
            </Elements>
          </div>
        </div>
      )}
    </div>
  )
}