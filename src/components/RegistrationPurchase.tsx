'use client'

import { useState, useEffect } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe-client'
import PaymentForm from './PaymentForm'
import { useToast } from '@/contexts/ToastContext'
import { getCategoryDisplayName } from '@/lib/registration-utils'
import { validateMembershipCoverage, formatMembershipWarning, calculateExtensionCost, type UserMembership } from '@/lib/membership-validation'
import { getRegistrationStatus, isRegistrationAvailable } from '@/lib/registration-status'

// Force import client config
import '../../instrumentation-client'
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
  current_count?: number
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
  is_active: boolean
  presale_start_at?: string | null
  regular_start_at?: string | null
  registration_end_at?: string | null
  presale_code?: string | null
  allow_lgbtq_presale?: boolean
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
  activeMemberships?: UserMembership[]
  isEligible: boolean
  isLgbtq: boolean
}

export default function RegistrationPurchase({ 
  registration, 
  userEmail, 
  activeMemberships = [],
  isEligible,
  isLgbtq
}: RegistrationPurchaseProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [presaleCode, setPresaleCode] = useState<string>('')
  const [discountCode, setDiscountCode] = useState<string>('')
  const [discountValidation, setDiscountValidation] = useState<any>(null)
  const [isValidatingDiscount, setIsValidatingDiscount] = useState(false)
  const [userWaitlistEntries, setUserWaitlistEntries] = useState<Record<string, { position: number, id: string }>>({})
  const [reservationExpiresAt, setReservationExpiresAt] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()

  // Cleanup function to remove processing reservation
  const cleanupProcessingReservation = async () => {
    try {
      await fetch(`/api/cleanup-processing-reservation?registrationId=${registration.id}`, {
        method: 'DELETE',
      })
    } catch (error) {
      console.error('Error cleaning up processing reservation:', error)
    }
  }

  // Close modal and cleanup to free capacity for other users
  const closeModal = async () => {
    // Update payment status to cancelled if user closes form
    if (paymentIntentId) {
      try {
        await fetch('/api/update-payment-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            stripePaymentIntentId: paymentIntentId,
            status: 'cancelled'
          }),
        })
        console.log(`✅ Updated payment ${paymentIntentId} status to cancelled (user closed form)`)
      } catch (error) {
        console.warn('Failed to update payment status to cancelled:', error)
      }
    }

    setShowPaymentForm(false)
    setClientSecret(null)
    setPaymentIntentId(null)
    setSelectedCategoryId(null) // Clear selected category
    setDiscountCode('')
    setDiscountValidation(null)
    setReservationExpiresAt(null)
    await cleanupProcessingReservation() // Free up spot for others
  }

  // Handle timer expiration
  const handleTimerExpired = async () => {
    // Update payment status to cancelled when timer expires
    if (paymentIntentId) {
      try {
        await fetch('/api/update-payment-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            stripePaymentIntentId: paymentIntentId,
            status: 'cancelled'
          }),
        })
        console.log(`✅ Updated payment ${paymentIntentId} status to cancelled (timer expired)`)
      } catch (error) {
        console.warn('Failed to update payment status to cancelled on timer expiry:', error)
      }
    }

    await cleanupProcessingReservation()
    setShowPaymentForm(false)
    setClientSecret(null)
    setPaymentIntentId(null)
    setSelectedCategoryId(null)
    setDiscountCode('')
    setDiscountValidation(null)
    setReservationExpiresAt(null)
    showError('Payment Timer Expired', 'Your reserved spot has been released. Please try registering again.')
  }

  const categories = registration.registration_categories || []
  const selectedCategory = categories.find(cat => cat.id === selectedCategoryId)
  
  // Get pricing for selected category
  const pricing = selectedCategory?.pricing || { price: 0, tierName: 'Standard' }
  
  // Calculate final price with discount
  const originalAmount = pricing.price
  const discountAmount = discountValidation?.isValid ? discountValidation.discountAmount : 0
  const finalAmount = originalAmount - discountAmount
  
  // Check registration timing status
  const registrationStatus = getRegistrationStatus(registration as any)
  const isPresale = registrationStatus === 'presale'
  const isLgbtqPresaleEligible = isPresale && isLgbtq && registration.allow_lgbtq_presale
  const hasValidPresaleCode = isPresale && 
    presaleCode.trim().toUpperCase() === registration.presale_code?.toUpperCase()
  const isTimingAvailable = isRegistrationAvailable(registration as any, hasValidPresaleCode || isLgbtqPresaleEligible)
  
  // Check if selected category is at capacity
  const isCategoryAtCapacity = selectedCategory?.max_capacity ? 
    (selectedCategory.current_count || 0) >= selectedCategory.max_capacity 
    : false
  
  // Check if user is already on waitlist for selected category
  const userWaitlistEntry = selectedCategoryId ? userWaitlistEntries[selectedCategoryId] : null
  const isUserOnWaitlist = !!userWaitlistEntry
  
  // Load user's existing waitlist entries for this registration via API
  useEffect(() => {
    const loadUserWaitlistEntries = async () => {
      if (!registration.id) return
      
      try {
        const response = await fetch(`/api/user-waitlists/${registration.id}`)
        
        if (!response.ok) {
          if (response.status === 401) {
            // User not authenticated, skip loading waitlist
            return
          }
          throw new Error('Failed to load waitlist entries')
        }
        
        const { waitlistEntries } = await response.json()
        setUserWaitlistEntries(waitlistEntries)
      } catch (error) {
        console.error('Error loading waitlist entries:', error)
      }
    }
    
    loadUserWaitlistEntries()
  }, [registration.id])
  

  // Check if selected category is eligible (basic membership check)
  const isCategoryEligible = selectedCategory ? 
    !selectedCategory.required_membership_id || 
    activeMemberships.some(um => um.membership?.id === selectedCategory.required_membership_id)
    : false


  // Enhanced validation: check if membership covers entire season
  const membershipValidation = selectedCategory?.required_membership_id && registration.season
    ? validateMembershipCoverage(
        selectedCategory.required_membership_id,
        activeMemberships,
        registration.season
      )
    : { isValid: true } // No membership required or no season info

  const hasSeasonCoverage = membershipValidation.isValid
  const membershipWarning = formatMembershipWarning(membershipValidation)
  const shouldShowSeasonWarning = selectedCategory && !hasSeasonCoverage && membershipWarning

  // Validate discount code
  const validateDiscountCode = async (code: string) => {
    if (!code.trim() || !selectedCategoryId) {
      setDiscountValidation(null)
      return
    }
    
    setIsValidatingDiscount(true)
    try {
      const response = await fetch('/api/validate-discount-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: code.trim(),
          registrationId: registration.id,
          amount: originalAmount
        }),
      })

      if (response.ok) {
        const result = await response.json()
        setDiscountValidation(result)
      } else {
        const errorData = await response.json()
        setDiscountValidation({ 
          isValid: false, 
          error: errorData.error || 'Invalid discount code' 
        })
      }
    } catch (err) {
      setDiscountValidation({ 
        isValid: false, 
        error: 'Failed to validate discount code' 
      })
    } finally {
      setIsValidatingDiscount(false)
    }
  }

  // Validate discount when code or selected category changes
  useEffect(() => {
    if (discountCode && selectedCategoryId) {
      const timeoutId = setTimeout(() => {
        validateDiscountCode(discountCode)
      }, 500) // Debounce validation
      
      return () => clearTimeout(timeoutId)
    } else {
      setDiscountValidation(null)
    }
  }, [discountCode, selectedCategoryId, originalAmount])

  const handlePurchase = async () => {
    if (!selectedCategoryId) {
      setError('Please select a category before registering')
      return
    }

    if (!isCategoryEligible) {
      setError('You need the required membership for this category')
      return
    }

    // Prevent registration if membership doesn't cover the full season
    if (!hasSeasonCoverage) {
      setError('Your membership must cover the entire season duration')
      return
    }

    setIsLoading(true)
    setError(null)
    
    // Handle waitlist joining if category is at capacity
    if (isCategoryAtCapacity) {
      // Prevent duplicate waitlist joins
      if (isUserOnWaitlist) {
        setError('You are already on the waitlist for this category')
        setIsLoading(false)
        return
      }
      
      try {
        const response = await fetch('/api/join-waitlist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registrationId: registration.id,
            categoryId: selectedCategoryId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to join waitlist')
        }

        const result = await response.json()
        
        // Update local state to reflect new waitlist entry
        setUserWaitlistEntries(prev => ({
          ...prev,
          [selectedCategoryId]: {
            position: result.position,
            id: result.waitlistId
          }
        }))
        
        // Show success message
        showSuccess(
          'Waitlist Joined!', 
          `You've been added to the waitlist. You're #${result.position} in line.`
        )
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred'
        setError(errorMessage)
        showError('Waitlist Error', errorMessage)
      } finally {
        setIsLoading(false)
      }
      return
    }

    // Regular registration flow - open payment modal AFTER getting fresh payment intent
    try {
      const response = await fetch('/api/create-registration-payment-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationId: registration.id,
          categoryId: selectedCategoryId,
          amount: originalAmount, // Use original amount, let backend apply discount
          presaleCode: hasValidPresaleCode ? presaleCode.trim() : null,
          discountCode: discountValidation?.isValid ? discountCode.trim() : null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create payment intent')
      }

      const responseData = await response.json()
      
      // Handle free registration (no payment needed)
      if (responseData.isFree) {
        setShowPaymentForm(false)
        setIsLoading(false)
        showSuccess(
          'Registration Complete!',
          'Your free registration has been completed successfully.'
        )
        // Refresh the page to show updated registration status
        setTimeout(() => window.location.reload(), 2000)
        return
      }
      
      const { clientSecret, paymentIntentId: intentId, reservationExpiresAt: expiresAt } = responseData
      setClientSecret(clientSecret)
      setPaymentIntentId(intentId)
      setReservationExpiresAt(expiresAt || null)
      setShowPaymentForm(true) // Only show form after we have fresh payment intent data
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
              const categoryName = getCategoryDisplayName(category as any)
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
                          <div className="text-xs text-gray-600">
                            Requires: {category.memberships?.name}
                          </div>
                        )}
                        {category.max_capacity && (
                          <div className={`text-xs ${
                            (() => {
                              const remaining = category.max_capacity - (category.current_count || 0)
                              const categoryWaitlistEntry = userWaitlistEntries[category.id]
                              if (remaining <= 0 && selectedCategoryId === category.id) {
                                return categoryWaitlistEntry ? 'text-blue-700' : 'text-red-700'
                              } else {
                                return 'text-gray-500'
                              }
                            })()
                          }`}>
                            {(() => {
                              const remaining = category.max_capacity - (category.current_count || 0)
                              const categoryWaitlistEntry = userWaitlistEntries[category.id]
                              
                              if (remaining <= 0) {
                                if (categoryWaitlistEntry) {
                                  return `On waitlist - Position #${categoryWaitlistEntry.position}`
                                } else {
                                  return 'Full - No spots remaining'
                                }
                              } else if (remaining === 1) {
                                return '1 spot remaining'
                              } else {
                                return `${remaining} spots remaining`
                              }
                            })()}
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
        // Single category - make it selectable like multiple categories
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Select Registration Category</h4>
          <div className="space-y-2">
            {categories.map((category) => {
              const categoryName = getCategoryDisplayName(category as any)
              const requiresMembership = category.required_membership_id
              const hasRequiredMembership = !requiresMembership || 
                activeMemberships.some(um => um.membership?.id === category.required_membership_id)
              const categoryPricing = category.pricing || { price: 5000, tierName: 'Standard' }
              
              return (
                <label key={category.id} className="cursor-pointer">
                  <input
                    type="radio"
                    name="registrationCategory"
                    value={category.id}
                    checked={selectedCategoryId === category.id}
                    onChange={() => setSelectedCategoryId(category.id)}
                    className="sr-only"
                  />
                  <div className={`border rounded-lg p-3 transition-colors ${
                    selectedCategoryId === category.id
                      ? hasRequiredMembership 
                        ? 'border-blue-600 ring-2 ring-blue-600 bg-blue-50' 
                        : 'border-yellow-500 bg-yellow-50'
                      : hasRequiredMembership
                      ? 'border-gray-300 hover:border-gray-400'
                      : 'border-yellow-300 bg-yellow-50 hover:border-yellow-400'
                  }`}>
                    <div className="flex justify-between">
                      <div>
                        <div className={`font-medium text-sm ${
                          selectedCategoryId === category.id
                            ? hasRequiredMembership ? 'text-blue-900' : 'text-yellow-800'
                            : hasRequiredMembership ? 'text-gray-900' : 'text-yellow-800'
                        }`}>
                          {categoryName}
                        </div>
                        {requiresMembership && (
                          <div className="text-xs text-gray-600">
                            Requires: {category.memberships?.name}
                          </div>
                        )}
                        {category.max_capacity && (
                          <div className={`text-xs ${
                            (() => {
                              const remaining = category.max_capacity - (category.current_count || 0)
                              const categoryWaitlistEntry = userWaitlistEntries[category.id]
                              
                              if (remaining <= 0) {
                                return categoryWaitlistEntry ? 'text-blue-500' : 'text-red-500'
                              } else {
                                return 'text-gray-500'
                              }
                            })()
                          }`}>
                            {(() => {
                              const remaining = category.max_capacity - (category.current_count || 0)
                              const categoryWaitlistEntry = userWaitlistEntries[category.id]
                              
                              if (remaining <= 0) {
                                if (categoryWaitlistEntry) {
                                  return `On waitlist - Position #${categoryWaitlistEntry.position}`
                                } else {
                                  return 'Full - No spots remaining'
                                }
                              } else if (remaining === 1) {
                                return '1 spot remaining'
                              } else {
                                return `${remaining} spots remaining`
                              }
                            })()}
                          </div>
                        )}
                      </div>
                      <div className={`text-sm font-medium ${
                        selectedCategoryId === category.id ? 'text-blue-900' : 'text-gray-900'
                      }`}>
                        ${(categoryPricing.price / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-md">
          <div className="text-gray-600 text-sm">
            No categories configured for this registration.
          </div>
        </div>
      )}

      {/* Registration Summary - Only show if not sold out */}
      {selectedCategoryId && selectedCategory && !isCategoryAtCapacity && (
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
              <span className="text-gray-900">{getCategoryDisplayName(selectedCategory as any)}</span>
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
      )}

      {/* Select Category Message - Only show if no category selected */}
      {!selectedCategoryId && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
          <p className="text-sm text-blue-800">
            <span className="font-medium">Select a category above</span> to see registration details.
          </p>
        </div>
      )}

      {/* Season Coverage Warning */}
      {shouldShowSeasonWarning && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="text-yellow-800 text-sm">
            <strong>Membership Extension Required:</strong> {membershipWarning}
          </div>
          <div className="mt-2 text-sm text-yellow-700">
            <a href="/user/browse-memberships" className="underline hover:text-yellow-900">
              Browse memberships to extend your coverage →
            </a>
          </div>
        </div>
      )}

      {/* Presale Code Input */}
      {isPresale && (
        <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-md">
          {isLgbtqPresaleEligible ? (
            <div className="text-purple-800 text-sm">
              <div className="flex items-start">
                <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <div><strong>Pre-Sale Registration:</strong> As an LGBTQ+ member of the organization, you can register in the pre-sale period.</div>
                  <div className="text-purple-800 mt-1">You have early access to this registration. No pre-sale code required.</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-purple-800 text-sm mb-3">
                <strong>Pre-Sale Registration:</strong> This registration is currently in pre-sale period and requires a special access code.
              </div>
              <div className="text-sm text-purple-700 mb-2">
                If you have a pre-sale code, please enter it here:
              </div>
              <input
                type="text"
                value={presaleCode}
                onChange={(e) => setPresaleCode(e.target.value.toUpperCase().trim())}
                placeholder="Enter pre-sale code"
                className="w-full px-3 py-2 border border-purple-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
              {hasValidPresaleCode && (
                <div className="mt-2 text-sm text-green-700 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Valid pre-sale code entered
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Sold Out Warning - Only show when selected category is at capacity */}
      {selectedCategory && isCategoryAtCapacity && (
        <div className={`mb-4 p-3 rounded-md ${
          isUserOnWaitlist 
            ? 'bg-blue-50 border border-blue-200' 
            : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center mb-2">
            {isUserOnWaitlist ? (
              <svg className="h-5 w-5 text-blue-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            )}
            <h4 className={`text-sm font-medium ${
              isUserOnWaitlist ? 'text-blue-800' : 'text-red-800'
            }`}>
              {isUserOnWaitlist ? 'You\'re on the Waitlist' : 'Category Sold Out'}
            </h4>
          </div>
          <p className={`text-sm ${
            isUserOnWaitlist ? 'text-blue-700' : 'text-red-700'
          }`}>
            {isUserOnWaitlist ? (
              `You're currently #${userWaitlistEntry?.position} in line for this category. We'll notify you if a spot becomes available.`
            ) : (
              `This category is currently at capacity (${selectedCategory.current_count} spots filled). You can join the waitlist and we'll notify you if a spot becomes available.`
            )}
          </p>
        </div>
      )}

      {/* Discount Code Section */}
      {selectedCategory && isTimingAvailable && !isCategoryAtCapacity && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 5a3 3 0 015-2.236A3 3 0 0114.83 6H16a2 2 0 110 4h-5V9a1 1 0 10-2 0v1H4a2 2 0 110-4h1.17C5.06 5.687 5 5.35 5 5zm4 1V5a1 1 0 10-1 1h1zm3 0a1 1 0 10-1-1v1h1z" clipRule="evenodd" />
            </svg>
            <div>
              <div className="text-sm font-medium text-green-800">Discount Code (Optional)</div>
              <div className="text-sm text-green-700 mt-1">
                Have a discount code? Enter it here to apply your discount:
              </div>
              <input
                type="text"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value.toUpperCase().trim())}
                placeholder="Enter discount code (e.g., PRIDE100)"
                className="w-full px-3 py-2 border border-green-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 mt-2"
              />
              
              {/* Validation States */}
              {isValidatingDiscount && (
                <div className="mt-2 text-sm text-green-700 flex items-center">
                  <svg className="animate-spin w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Validating discount code...
                </div>
              )}
              
              {discountValidation?.isValid && (
                <div className={`mt-2 text-sm flex items-start ${discountValidation.isPartialDiscount ? 'text-yellow-700' : 'text-green-700'}`}>
                  <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    {discountValidation.isPartialDiscount ? (
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    ) : (
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    )}
                  </svg>
                  <div>
                    <div className="font-medium">
                      {discountValidation.isPartialDiscount ? (
                        discountValidation.partialDiscountMessage
                      ) : (
                        <>
                          {discountValidation.discountCode.percentage}% discount applied! 
                          Save ${(discountValidation.discountAmount / 100).toFixed(2)}
                        </>
                      )}
                    </div>
                    {!discountValidation.isPartialDiscount && (
                      <div className="text-xs">
                        {discountValidation.discountCode.category.name}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {discountValidation?.isValid === false && discountCode && (
                <div className="mt-2 text-sm text-red-700 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {discountValidation.error}
                </div>
              )}
            </div>
          </div>
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
        disabled={isLoading || !selectedCategoryId || !isCategoryEligible || !hasSeasonCoverage || !isTimingAvailable || (isCategoryAtCapacity && isUserOnWaitlist)}
        className={`w-full px-4 py-2 rounded-md text-sm font-medium transition-colors text-white ${
          isCategoryAtCapacity 
            ? (isUserOnWaitlist ? 'bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed')
            : 'bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed'
        }`}
      >
        {isLoading ? 'Processing...' : 
         !selectedCategoryId ? 'Select Category to Continue' :
         !isCategoryEligible ? 'Membership Required' :
         !hasSeasonCoverage ? 'Membership Extension Required' :
         !isTimingAvailable ? (isPresale ? 'Pre-Sale Code Required' : 'Registration Not Available') :
         (isCategoryAtCapacity && isUserOnWaitlist) ? `On Waitlist - Position #${userWaitlistEntry?.position}` :
         isCategoryAtCapacity ? 'Join Waitlist' :
         'Register Now'}
      </button>

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Complete Registration</h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">{registration.name} - {selectedCategory ? getCategoryDisplayName(selectedCategory as any) : ''}</div>
              
              {/* Pricing Breakdown */}
              {discountValidation?.isValid ? (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal:</span>
                    <span>${(originalAmount / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount ({discountValidation.discountCode.code}):</span>
                    <span>-${(discountAmount / 100).toFixed(2)}</span>
                  </div>
                  <div className="border-t pt-1 flex justify-between font-medium text-gray-900">
                    <span>Total:</span>
                    <span>${(finalAmount / 100).toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600 mt-2">Total: <span className="font-medium text-gray-900">${(originalAmount / 100).toFixed(2)}</span></div>
              )}
            </div>

            {clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  registrationId={registration.id}
                  categoryId={selectedCategoryId!}
                  amount={finalAmount}
                  userEmail={userEmail}
                  reservationExpiresAt={reservationExpiresAt || undefined}
                  onTimerExpired={handleTimerExpired}
                  paymentIntentId={paymentIntentId || undefined}
                  onSuccess={() => {
                    setShowPaymentForm(false)
                    setClientSecret(null)
                    // Reset form state
                    setSelectedCategoryId(null)
                    setDiscountCode('')
                    setDiscountValidation(null)
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