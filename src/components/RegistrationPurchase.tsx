'use client'

import { useState, useEffect } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe-client'
import PaymentForm from './PaymentForm'
import { useToast } from '@/contexts/ToastContext'
import { getCategoryDisplayName } from '@/lib/registration-utils'

// Force import client config
import '../../sentry.client.config'
import * as Sentry from '@sentry/nextjs'

// Helper function to safely parse date strings without timezone conversion
function formatDateString(dateString: string): string {
  if (!dateString) return 'N/A'
  
  // Parse the date components manually to avoid timezone issues
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  
  return date.toLocaleDateString()
}

interface RegistrationCategory {
  id: string
  custom_name?: string
  max_capacity?: number
  required_membership_id?: string
  categories?: {
    name: string
  }
  memberships?: {
    name: string
  }
  pricing?: {
    price: number
    tierName: string
  }
}

interface Registration {
  id: string
  name: string
  type: string
  season?: {
    name: string
    start_date: string
    end_date: string
  }
  registration_categories?: RegistrationCategory[]
}

interface RegistrationPurchaseProps {
  registration: Registration
  userEmail: string
  activeMemberships?: Array<{
    membership?: {
      id: string
      name: string
    }
  }>
  isEligible: boolean
}

export default function RegistrationPurchase({ 
  registration, 
  userEmail, 
  activeMemberships = [],
  isEligible
}: RegistrationPurchaseProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()

  const categories = registration.registration_categories || []
  const selectedCategory = categories.find(cat => cat.id === selectedCategoryId)
  
  // Get pricing for selected category
  const pricing = selectedCategory?.pricing || { price: 0, tierName: 'Standard' }
  
  // Auto-select single category if eligible
  useEffect(() => {
    if (categories.length === 1 && !selectedCategoryId) {
      const category = categories[0]
      const hasRequiredMembership = !category.required_membership_id || 
        activeMemberships.some(um => um.membership?.id === category.required_membership_id)
      
      if (hasRequiredMembership) {
        setSelectedCategoryId(category.id)
      }
    }
  }, [categories, selectedCategoryId, activeMemberships])

  // Check if selected category is eligible
  const isCategoryEligible = selectedCategory ? 
    !selectedCategory.required_membership_id || 
    activeMemberships.some(um => um.membership?.id === selectedCategory.required_membership_id)
    : false

  const handlePurchase = async () => {
    if (!selectedCategoryId) {
      setError('Please select a category before registering')
      return
    }

    if (!isCategoryEligible) {
      setError('You need the required membership for this category')
      return
    }

    // Open modal immediately for better perceived performance
    setShowPaymentForm(true)
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/create-registration-payment-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationId: registration.id,
          categoryId: selectedCategoryId,
          amount: pricing.price, // For now using base price, later implement tiered pricing
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create payment intent')
      }

      const { clientSecret } = await response.json()
      setClientSecret(clientSecret)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMessage)
      setShowPaymentForm(false) // Close modal on error
      
      // Show error notification
      showError(
        'Setup Error', 
        'Unable to initialize payment. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-4">
      {/* Eligibility Warning */}
      {!isEligible && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="text-yellow-800 text-sm">
            <strong>Membership Required:</strong> You need an active membership to register for this event.
          </div>
        </div>
      )}

      {/* Category Selection */}
      {categories.length > 1 ? (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Category
          </label>
          <div className="grid grid-cols-1 gap-2">
            {categories.map((category) => {
              const categoryName = getCategoryDisplayName(category)
              const requiresMembership = category.required_membership_id
              const hasRequiredMembership = !requiresMembership || 
                activeMemberships.some(um => um.membership?.id === category.required_membership_id)
              const categoryPricing = category.pricing || { price: 5000, tierName: 'Standard' }
              
              return (
                <label
                  key={category.id}
                  className={`relative flex cursor-pointer rounded-lg border p-3 focus:outline-none ${
                    selectedCategoryId === category.id
                      ? 'border-blue-600 ring-2 ring-blue-600 bg-blue-50'
                      : hasRequiredMembership
                      ? 'border-gray-300 hover:border-gray-400'
                      : 'border-yellow-300 bg-yellow-50'
                  } ${!hasRequiredMembership ? 'cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="category"
                    value={category.id}
                    checked={selectedCategoryId === category.id}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    disabled={!hasRequiredMembership}
                    className="sr-only"
                  />
                  <div className="flex w-full justify-between">
                    <div className="flex items-center">
                      <div className="text-sm">
                        <div className={`font-medium ${
                          selectedCategoryId === category.id ? 'text-blue-900' : 
                          hasRequiredMembership ? 'text-gray-900' : 'text-yellow-800'
                        }`}>
                          {categoryName}
                        </div>
                        {requiresMembership && (
                          <div className={`text-xs ${
                            hasRequiredMembership ? 'text-green-600' : 'text-yellow-600'
                          }`}>
                            {hasRequiredMembership ? '✓ ' : '⚠ Requires: '}
                            {category.memberships?.name}
                          </div>
                        )}
                        {category.max_capacity && (
                          <div className="text-xs text-gray-500">
                            Capacity: {category.max_capacity}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`text-sm font-medium ${
                      selectedCategoryId === category.id ? 'text-blue-900' : 'text-gray-900'
                    }`}>
                      ${(categoryPricing.price / 100).toFixed(2)}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      ) : categories.length === 1 ? (
        // Single category - auto-select it
        <div className="mb-4">
          {(() => {
            const category = categories[0]
            const categoryName = getCategoryDisplayName(category)
            const requiresMembership = category.required_membership_id
            const hasRequiredMembership = !requiresMembership || 
              activeMemberships.some(um => um.membership?.id === category.required_membership_id)
            const categoryPricing = category.pricing || { price: 5000, tierName: 'Standard' }
            
            // Auto-selection handled by useEffect
            
            return (
              <div className={`border rounded-lg p-3 ${
                hasRequiredMembership ? 'border-green-300 bg-green-50' : 'border-yellow-300 bg-yellow-50'
              }`}>
                <div className="flex justify-between">
                  <div>
                    <div className={`font-medium text-sm ${
                      hasRequiredMembership ? 'text-green-900' : 'text-yellow-800'
                    }`}>
                      {categoryName}
                    </div>
                    {requiresMembership && (
                      <div className={`text-xs ${
                        hasRequiredMembership ? 'text-green-600' : 'text-yellow-600'
                      }`}>
                        {hasRequiredMembership ? '✓ ' : '⚠ Requires: '}
                        {category.membership?.name}
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-medium text-gray-900">
                    ${(categoryPricing.price / 100).toFixed(2)}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      ) : (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-md">
          <div className="text-gray-600 text-sm">
            No categories configured for this registration.
          </div>
        </div>
      )}

      {/* Registration Summary */}
      {selectedCategoryId && selectedCategory ? (
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Registration Summary</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Event:</span>
              <span className="text-gray-900">{registration.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Type:</span>
              <span className="text-gray-900">{registration.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Season:</span>
              <span className="text-gray-900">{registration.season?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Category:</span>
              <span className="text-gray-900">{getCategoryDisplayName(selectedCategory)}</span>
            </div>
            {registration.season && (
              <div className="flex justify-between">
                <span className="text-gray-600">Duration:</span>
                <span className="text-gray-900">
                  {formatDateString(registration.season.start_date)} - {formatDateString(registration.season.end_date)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 font-medium">
              <span className="text-gray-900">Total:</span>
              <span className="text-gray-900">${(pricing.price / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
          <p className="text-sm text-blue-800">
            <span className="font-medium">Select a category above</span> to see registration details.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-red-800 text-sm">{error}</div>
        </div>
      )}

      {/* Register Button */}
      <button
        onClick={handlePurchase}
        disabled={isLoading || !selectedCategoryId || !isCategoryEligible}
        className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
      >
        {isLoading ? 'Processing...' : 
         !selectedCategoryId ? 'Select Category to Continue' :
         !isCategoryEligible ? 'Membership Required' :
         'Register Now'}
      </button>

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Complete Registration</h3>
              <button
                onClick={() => {
                  setShowPaymentForm(false)
                  setClientSecret(null)
                  setIsLoading(false)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total: <span className="font-medium text-gray-900">${(pricing.price / 100).toFixed(2)}</span></div>
              <div className="text-sm text-gray-600">{registration.name} - {selectedCategory ? getCategoryDisplayName(selectedCategory) : ''}</div>
            </div>

            {clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  registrationId={registration.id}
                  categoryId={selectedCategoryId!}
                  amount={pricing.price}
                  userEmail={userEmail}
                  onSuccess={() => {
                    setShowPaymentForm(false)
                    setClientSecret(null)
                    // Reset form state
                    setSelectedCategoryId(null)
                    setError(null)
                    
                    // Show success notification
                    showSuccess(
                      'Registration Successful!', 
                      `You are now registered for ${registration.name}.`
                    )
                    
                    // Scroll to top to show updated registration status
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                    // Refresh the page to show updated registrations (delayed for user to see success)
                    setTimeout(() => window.location.reload(), 2000)
                  }}
                  onError={(error) => {
                    setError(error)
                    setShowPaymentForm(false)
                    
                    // Show error notification
                    showError(
                      'Registration Failed', 
                      error || 'There was an issue processing your registration. Please try again.'
                    )
                  }}
                />
              </Elements>
            ) : (
              // Show loading skeleton while payment intent is being created
              <div className="space-y-4">
                <div className="text-center text-sm text-gray-500 mb-4">
                  Setting up secure payment...
                </div>
                <div className="space-y-4 animate-pulse">
                  <div className="space-y-3">
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                    <div className="h-12 bg-gray-200 rounded"></div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-4 bg-gray-200 rounded w-32"></div>
                    <div className="h-12 bg-gray-200 rounded"></div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-4 bg-gray-200 rounded w-20"></div>
                    <div className="h-12 bg-gray-200 rounded"></div>
                  </div>
                  <div className="h-12 bg-gray-300 rounded"></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}