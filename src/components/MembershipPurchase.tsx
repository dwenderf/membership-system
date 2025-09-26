'use client'

import React, { useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe-client'
import PaymentForm from './PaymentForm'
import PaymentMethodNotice from './PaymentMethodNotice'
import PaymentConfirmationScreen from './PaymentConfirmationScreen'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import { handlePaymentFlow, PaymentFlowData } from '@/lib/payment-flow-dispatcher'
import { calculateMembershipDates, isMembershipExtension } from '@/lib/membership-utils'

// Force import client config
import '../../instrumentation-client'

interface Membership {
  id: string
  name: string
  description?: string
  price_monthly: number
  price_annual: number
  allow_monthly: boolean
}

interface MembershipPurchaseProps {
  membership: Membership
  userEmail: string
  userMemberships?: Array<{
    valid_until: string
    membership?: {
      id: string
    }
  }>
}

const DURATION_OPTIONS = [
  { months: 3, label: '3 Months', requiresMonthly: true },
  { months: 6, label: '6 Months', requiresMonthly: true },
  { months: 12, label: '12 Months (Annual)', requiresMonthly: false },
]

export default function MembershipPurchase({ membership, userEmail, userMemberships = [] }: MembershipPurchaseProps) {
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null) // No default selection
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [purchaseCompleted, setPurchaseCompleted] = useState(false)
  
  // Payment option states
  const [paymentOption, setPaymentOption] = useState<'assistance' | 'donation' | 'standard' | null>(null)
  const [requestedPurchaseAmount, setAssistanceAmount] = useState<string>('') // Display value
  const [donationAmount, setDonationAmount] = useState<string>('50.00') // Display value
  const [shouldSavePaymentMethod, setShouldSavePaymentMethod] = useState(false)
  const [showConfirmationScreen, setShowConfirmationScreen] = useState(false)
  const [userHasSavedPaymentMethod, setUserHasSavedPaymentMethod] = useState<boolean | null>(null)
  
  const { showSuccess, showError } = useToast()

  // Check if user has saved payment method
  React.useEffect(() => {
    const checkSavedPaymentMethod = async () => {
      try {
        const response = await fetch('/api/user-payment-method')
        if (response.ok) {
          const data = await response.json()
          setUserHasSavedPaymentMethod(!!data.paymentMethod)
        } else {
          setUserHasSavedPaymentMethod(false)
        }
      } catch (error) {
        console.error('Error checking saved payment method:', error)
        setUserHasSavedPaymentMethod(false)
      }
    }
    
    checkSavedPaymentMethod()
  }, [])

  const calculatePrice = (months: number) => {
    if (months === 12) {
      return membership.price_annual
    }
    return membership.price_monthly * months
  }

  const calculateSavings = (months: number) => {
    // Only calculate savings if monthly pricing is available
    if (!membership.allow_monthly) {
      return 0
    }
    const regularPrice = membership.price_monthly * months
    const actualPrice = calculatePrice(months)
    return regularPrice - actualPrice
  }

  const selectedPrice = selectedDuration ? calculatePrice(selectedDuration) : 0
  const savings = selectedDuration ? calculateSavings(selectedDuration) : 0
  
  // Calculate final payment amount based on payment option
  const getFinalPaymentAmount = () => {
    // selectedPrice could be 0 for free memberships, so don't return early
    const basePrice = selectedPrice || 0
    
    switch (paymentOption) {
      case 'assistance':
        const assistance = parseFloat(requestedPurchaseAmount) || 0
        return Math.max(0, Math.min(assistance * 100, basePrice)) // Convert to cents, cap at full price
      case 'donation':
        const donation = parseFloat(donationAmount) || 0
        return basePrice + (donation * 100) // Convert to cents - works for free memberships too
      case 'standard':
      default:
        return basePrice
    }
  }
  
  const finalAmount = getFinalPaymentAmount()
  
  // Set default assistance amount when duration changes
  React.useEffect(() => {
    if (selectedDuration && selectedPrice && paymentOption === 'assistance') {
      const defaultAssistance = (selectedPrice / 100 * 0.5).toFixed(2) // 50% of full price
      setAssistanceAmount(defaultAssistance)
    }
  }, [selectedDuration, selectedPrice, paymentOption])
  
  // Handle payment option for free memberships
  React.useEffect(() => {
    if (selectedDuration && selectedPrice === 0) {
      // For free memberships, reset to null if assistance was selected (now hidden)
      // Let user choose between donation or standard
      if (paymentOption === 'assistance') {
        setPaymentOption(null)
      }
    }
  }, [selectedDuration, selectedPrice, paymentOption])
  
  // Calculate validity period - start from latest expiration date of current memberships of same type, or September 1, 2025 for new memberships
  const { startDate, endDate } = selectedDuration 
    ? calculateMembershipDates(membership.id, selectedDuration, userMemberships)
    : { startDate: new Date(), endDate: new Date() }
  
  const isExtension = isMembershipExtension(startDate)


  const handlePurchase = async () => {
    if (!selectedDuration) {
      setError('Please select a duration before purchasing')
      return
    }
    
    if (!paymentOption) {
      setError('Please select a payment option before purchasing')
      return
    }

    setIsLoading(true)
    setError(null)
    
    try {
      // Check if user has saved payment method and show confirmation screen
      if (userHasSavedPaymentMethod && finalAmount > 0) {
        setShowConfirmationScreen(true)
        setIsLoading(false)
        return
      }

      const paymentData: PaymentFlowData = {
        amount: finalAmount,
        membershipId: membership.id,
        durationMonths: selectedDuration,
        paymentOption: paymentOption,
        assistanceAmount: paymentOption === 'assistance' ? (selectedPrice - parseFloat(requestedPurchaseAmount) * 100) : undefined, // Positive assistance amount (amount being discounted)
        donationAmount: paymentOption === 'donation' ? parseFloat(donationAmount) * 100 : undefined,
        savePaymentMethod: shouldSavePaymentMethod,
      }

      const result = await handlePaymentFlow(paymentData)
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to process payment')
      }

      if (result.isFree) {
        // Free membership completed
        setPurchaseCompleted(true)
        showSuccess(
          'Membership Activated!',
          result.message || 'Your free membership has been activated successfully.'
        )
        return
      }
      
      // Paid membership - show payment form
      setShowPaymentForm(true)
      setClientSecret(result.clientSecret!)
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

  // Handle saved method payment confirmation
  const handleConfirmSavedMethod = async () => {
    if (!selectedDuration || !paymentOption) return

    try {
      const response = await fetch('/api/pay-with-saved-method', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          membershipId: membership.id,
          durationMonths: selectedDuration,
          amount: finalAmount,
          paymentOption: paymentOption,
          assistanceAmount: paymentOption === 'assistance' ? (selectedPrice - parseFloat(requestedPurchaseAmount) * 100) : undefined,
          donationAmount: paymentOption === 'donation' ? parseFloat(donationAmount) * 100 : undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Payment failed')
      }

      const result = await response.json()
      
      setShowConfirmationScreen(false)
      setPurchaseCompleted(true)
      setError(null)
      
      showSuccess(
        'Membership Activated!',
        result.message || 'Your membership has been activated successfully.'
      )
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment failed'
      setError(errorMessage)
      showError('Payment Failed', errorMessage)
    }
  }

  // Handle using different payment method
  const handleUseDifferentMethod = async () => {
    if (!selectedDuration || !paymentOption) return

    setShowConfirmationScreen(false)
    setIsLoading(true)
    setError(null)
    
    // Continue with regular payment flow (bypass saved method check)
    try {
      const paymentData: PaymentFlowData = {
        amount: finalAmount,
        membershipId: membership.id,
        durationMonths: selectedDuration,
        paymentOption: paymentOption,
        assistanceAmount: paymentOption === 'assistance' ? (selectedPrice - parseFloat(requestedPurchaseAmount) * 100) : undefined,
        donationAmount: paymentOption === 'donation' ? parseFloat(donationAmount) * 100 : undefined,
        savePaymentMethod: shouldSavePaymentMethod,
      }

      const result = await handlePaymentFlow(paymentData)
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to process payment')
      }

      if (result.isFree) {
        // Free membership completed
        setPurchaseCompleted(true)
        showSuccess(
          'Membership Activated!',
          result.message || 'Your free membership has been activated successfully.'
        )
        return
      }
      
      // Paid membership - show payment form
      setShowPaymentForm(true)
      setClientSecret(result.clientSecret!)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMessage)
      setShowPaymentForm(false)
      showError(
        'Setup Error', 
        'Unable to initialize payment. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Show success state if purchase completed
  if (purchaseCompleted) {
    return (
      <div className="mt-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="flex justify-center mb-4">
            <svg className="h-12 w-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-green-900 mb-2">
            Membership Purchase Complete!
          </h3>
          <p className="text-green-800 mb-6">
            Your {membership.name} is now active. You can register for teams, events, and activities.
          </p>
          <div className="space-y-3">
            <Link
              href="/user/browse-registrations"
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors"
            >
              Browse Available Registrations →
            </Link>
            <div>
              <button
                onClick={() => window.location.reload()}
                className="text-sm text-gray-600 hover:text-gray-800 underline"
              >
                Refresh to see updated membership status
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4">
      {/* Duration Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Duration
        </label>
        <div className="grid grid-cols-1 gap-2">
          {DURATION_OPTIONS
            .filter(option => !option.requiresMonthly || membership.allow_monthly)
            .map((option) => {
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
                      {optionSavings > 0 && membership.allow_monthly && (
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

      {/* Payment Options */}
      {selectedDuration && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Payment Options
          </label>
          <div className="space-y-3">
            {/* Option 1: Need Help - Only show for paid memberships */}
            {selectedPrice > 0 && (
              <label className={`relative flex cursor-pointer rounded-lg border p-4 focus:outline-none ${
                paymentOption === 'assistance'
                  ? 'border-blue-600 ring-2 ring-blue-600 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}>
                <input
                  type="radio"
                  name="paymentOption"
                  value="assistance"
                  checked={paymentOption === 'assistance'}
                  onChange={(e) => {
                    setPaymentOption('assistance')
                    if (selectedPrice) {
                      const defaultAssistance = (selectedPrice / 100 * 0.5).toFixed(2)
                      setAssistanceAmount(defaultAssistance)
                    }
                  }}
                  className="sr-only"
                />
                <div className="w-full">
                  <div className={`text-sm font-medium ${
                    paymentOption === 'assistance' ? 'text-blue-900' : 'text-gray-900'
                  }`}>
                    I need help paying for membership
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Pay what you can afford (up to full price)
                  </div>
                  {paymentOption === 'assistance' && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        How much are you able to pay?
                      </label>
                      <div className="relative rounded-md shadow-sm max-w-32">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500 text-sm">$</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={(selectedPrice / 100).toFixed(2)}
                          step="0.01"
                          value={requestedPurchaseAmount}
                          onChange={(e) => setAssistanceAmount(e.target.value)}
                          className="block w-full pl-7 pr-3 py-2 border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900"
                          placeholder="0.00"
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Maximum: ${(selectedPrice / 100).toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              </label>
            )}

            {/* Option 2: Donation */}
            <label className={`relative flex cursor-pointer rounded-lg border p-4 focus:outline-none ${
              paymentOption === 'donation'
                ? 'border-blue-600 ring-2 ring-blue-600 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}>
              <input
                type="radio"
                name="paymentOption"
                value="donation"
                checked={paymentOption === 'donation'}
                onChange={(e) => setPaymentOption('donation')}
                className="sr-only"
              />
              <div className="w-full">
                <div className={`text-sm font-medium ${
                  paymentOption === 'donation' ? 'text-blue-900' : 'text-gray-900'
                }`}>
                  I'd like to make an additional donation to support the membership
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Support other members who need assistance
                </div>
                {paymentOption === 'donation' && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Additional donation amount
                    </label>
                    <div className="relative rounded-md shadow-sm max-w-32">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-gray-500 text-sm">$</span>
                      </div>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        step="0.01"
                        value={donationAmount}
                        onChange={(e) => setDonationAmount(e.target.value)}
                        className="block w-full pl-7 pr-3 py-2 border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900"
                        placeholder="50.00"
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Range: $1.00 - $1,000.00
                    </div>
                  </div>
                )}
              </div>
            </label>

            {/* Option 3: Standard */}
            <label className={`relative flex cursor-pointer rounded-lg border p-4 focus:outline-none ${
              paymentOption === 'standard'
                ? 'border-blue-600 ring-2 ring-blue-600 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}>
              <input
                type="radio"
                name="paymentOption"
                value="standard"
                checked={paymentOption === 'standard'}
                onChange={(e) => setPaymentOption('standard')}
                className="sr-only"
              />
              <div className="w-full">
                <div className={`text-sm font-medium ${
                  paymentOption === 'standard' ? 'text-blue-900' : 'text-gray-900'
                }`}>
                  I do not wish to make any additional donation at this time
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Pay the standard membership price
                </div>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Purchase Summary */}
      {selectedDuration ? (
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
            {savings > 0 && membership.allow_monthly && (
              <div className="flex justify-between text-green-600">
                <span>Savings:</span>
                <span>${(savings / 100).toFixed(2)}</span>
              </div>
            )}
            
            {/* Payment option breakdown */}
            {paymentOption && (
              <>
                <div className="border-t pt-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Membership Price:</span>
                    <span className="text-gray-900">${(selectedPrice / 100).toFixed(2)}</span>
                  </div>
                  
                  {paymentOption === 'assistance' && (
                    <div className="flex justify-between text-orange-600">
                      <span>Assistance Discount:</span>
                      <span>-${((selectedPrice - finalAmount) / 100).toFixed(2)}</span>
                    </div>
                  )}
                  
                  {paymentOption === 'donation' && (
                    <div className="flex justify-between text-blue-600">
                      <span>Additional Donation:</span>
                      <span>+${((finalAmount - selectedPrice) / 100).toFixed(2)}</span>
                    </div>
                  )}
                  
                  <div className="flex justify-between font-medium text-lg mt-2 pt-2 border-t">
                    <span className="text-gray-900">Total:</span>
                    <span className="text-gray-900">${(finalAmount / 100).toFixed(2)}</span>
                  </div>
                </div>
              </>
            )}
            
            {!paymentOption && (
              <div className="flex justify-between border-t pt-2 font-medium">
                <span className="text-gray-900">Total:</span>
                <span className="text-gray-900">${(selectedPrice / 100).toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
          <p className="text-sm text-blue-800">
            <span className="font-medium">Select a duration above</span> to see pricing details and purchase summary.
          </p>
        </div>
      )}

      {/* Payment Method Notice - Only show for paid memberships and user doesn't have saved method */}
      {selectedDuration && paymentOption && finalAmount > 0 && userHasSavedPaymentMethod === false && (
        <div className="mb-4">
          <PaymentMethodNotice
            userEmail={userEmail}
            onSavePaymentChange={setShouldSavePaymentMethod}
            showForAlternate={false}
          />
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-red-800 text-sm">{error}</div>
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={isLoading || !selectedDuration || !paymentOption}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
      >
        {isLoading 
          ? 'Processing...' 
          : !selectedDuration 
            ? 'Select Duration to Continue'
            : !paymentOption
              ? 'Select Payment Option to Continue'
              : `Purchase Membership - $${(finalAmount / 100).toFixed(2)}`
        }
      </button>

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Complete Payment</h3>
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
              <div className="text-sm text-gray-600">Total: <span className="font-medium text-gray-900">${(finalAmount / 100).toFixed(2)}</span></div>
              <div className="text-sm text-gray-600">{membership.name} - {selectedDuration} months</div>
            </div>

            {clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  membershipId={membership.id}
                  durationMonths={selectedDuration!}
                  amount={finalAmount}
                  startDate={startDate}
                  endDate={endDate}
                  userEmail={userEmail}
                  shouldSavePaymentMethod={shouldSavePaymentMethod}
                  onSuccess={() => {
                    setShowPaymentForm(false)
                    setClientSecret(null)
                    setError(null)
                    setPurchaseCompleted(true)
                    
                    // Show success notification
                    showSuccess(
                      'Purchase Successful!', 
                      `Your ${membership.name} membership is now active for ${selectedDuration} months. You can now register for teams and events!`
                    )
                    
                    // Scroll to top to show success section
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  onError={(error) => {
                    setError(error)
                    setShowPaymentForm(false)
                    
                    // Show error notification
                    showError(
                      'Payment Failed', 
                      error || 'There was an issue processing your payment. Please try again.'
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

      {/* Payment Confirmation Screen Modal */}
      {showConfirmationScreen && (
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-25 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowConfirmationScreen(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PaymentConfirmationScreen
              userEmail={userEmail}
              amount={finalAmount}
              membershipName={membership.name}
              durationMonths={selectedDuration}
              onConfirmSavedMethod={handleConfirmSavedMethod}
              onUseDifferentMethod={handleUseDifferentMethod}
              onCancel={() => setShowConfirmationScreen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}