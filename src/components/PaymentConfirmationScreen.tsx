'use client'

import { useState, useEffect } from 'react'

interface PaymentMethodInfo {
  hasPaymentMethod: boolean
  last4?: string
  brand?: string
}

interface PaymentConfirmationScreenProps {
  // Common props
  userEmail: string
  amount: number
  onConfirmSavedMethod: () => void
  onUseDifferentMethod: () => void
  onCancel: () => void
  
  // Registration props
  registrationName?: string
  categoryName?: string
  seasonName?: string
  
  // Membership props  
  membershipName?: string
  durationMonths?: number
  
  // Discount info
  originalAmount?: number
  discountAmount?: number
  discountCode?: string
  
  // Reservation timer (for registrations)
  reservationExpiresAt?: string
  onTimerExpired?: () => void
}

export default function PaymentConfirmationScreen({
  userEmail,
  amount,
  onConfirmSavedMethod,
  onUseDifferentMethod,
  onCancel,
  registrationName,
  categoryName,
  seasonName,
  membershipName,
  durationMonths,
  originalAmount,
  discountAmount,
  discountCode,
  reservationExpiresAt,
  onTimerExpired
}: PaymentConfirmationScreenProps) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentMethodInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  // Initialize and update countdown timer
  useEffect(() => {
    if (!reservationExpiresAt) return

    const updateTimer = () => {
      const now = new Date()
      const expires = new Date(reservationExpiresAt)
      const secondsLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000))
      
      setTimeLeft(secondsLeft)
      
      if (secondsLeft === 0 && onTimerExpired) {
        onTimerExpired()
      }
    }

    // Initial update
    updateTimer()
    
    // Update every second
    const timer = setInterval(updateTimer, 1000)
    
    return () => clearInterval(timer)
  }, [reservationExpiresAt, onTimerExpired])

  useEffect(() => {
    fetchPaymentMethodInfo()
  }, [])

  const fetchPaymentMethodInfo = async () => {
    try {
      const response = await fetch('/api/user-payment-method')
      if (response.ok) {
        const data = await response.json()
        setPaymentInfo({
          hasPaymentMethod: !!data.paymentMethod,
          last4: data.paymentMethod?.last4,
          brand: data.paymentMethod?.brand
        })
      } else {
        setPaymentInfo({ hasPaymentMethod: false })
      }
    } catch (error) {
      console.error('Error fetching payment method:', error)
      setPaymentInfo({ hasPaymentMethod: false })
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmPayment = async () => {
    setIsProcessing(true)
    try {
      await onConfirmSavedMethod()
    } catch (error) {
      setIsProcessing(false)
      // Error handling will be done by parent component
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <div className="text-center">
          <div className="text-sm text-gray-500">Loading payment information...</div>
        </div>
      </div>
    )
  }

  // If no saved payment method, fall back to regular form
  if (!paymentInfo?.hasPaymentMethod) {
    onUseDifferentMethod()
    return null
  }

  const cardDisplay = paymentInfo.brand && paymentInfo.last4 
    ? `${paymentInfo.brand.toUpperCase()} •••• ${paymentInfo.last4}`
    : 'Saved payment method'

  const isRegistration = !!registrationName
  const finalAmount = amount / 100

  return (
    <div className="bg-white rounded-lg p-6 max-w-md w-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-medium text-gray-900">
          {isRegistration ? 'Complete Registration' : 'Complete Purchase'}
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
        >
          <span className="sr-only">Close</span>
          ✕
        </button>
      </div>

      {/* Countdown Timer for registrations */}
      {timeLeft !== null && (
        <div className="mb-6 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse mr-2"></div>
              <span className="text-sm font-medium text-orange-900">Complete payment in:</span>
            </div>
            <span className="text-lg font-mono font-bold text-orange-600">
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </span>
          </div>
          <p className="text-xs text-orange-700 mt-1">
            Your spot is reserved until the timer expires
          </p>
        </div>
      )}

      {/* Purchase Summary */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Purchase Summary</h4>
        <div className="space-y-2 text-sm">
          {isRegistration ? (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Event:</span>
                <span className="text-gray-900">{registrationName}</span>
              </div>
              {categoryName && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Category:</span>
                  <span className="text-gray-900">{categoryName}</span>
                </div>
              )}
              {seasonName && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Season:</span>
                  <span className="text-gray-900">{seasonName}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Membership:</span>
                <span className="text-gray-900">{membershipName}</span>
              </div>
              {durationMonths && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Duration:</span>
                  <span className="text-gray-900">{durationMonths} months</span>
                </div>
              )}
            </>
          )}
          
          {/* Pricing breakdown */}
          {discountAmount && discountAmount > 0 ? (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="text-gray-900">${((originalAmount || amount) / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Discount{discountCode ? ` (${discountCode})` : ''}:</span>
                <span>-${(discountAmount / 100).toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-medium text-lg">
                <span className="text-gray-900">Total:</span>
                <span className="text-gray-900">${finalAmount.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div className="border-t pt-2 flex justify-between font-medium text-lg">
              <span className="text-gray-900">Total:</span>
              <span className="text-gray-900">${finalAmount.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Saved Payment Method */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-blue-900">Saved Payment Method</h4>
            <div className="mt-1 text-sm text-blue-700">
              {cardDisplay}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={handleConfirmPayment}
          disabled={isProcessing}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-3 rounded-md text-sm font-medium transition-colors"
        >
          {isProcessing ? (
            <div className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing Payment...
            </div>
          ) : (
            `Pay $${finalAmount.toFixed(2)} with ${cardDisplay}`
          )}
        </button>
        
        <button
          onClick={onUseDifferentMethod}
          disabled={isProcessing}
          className="w-full bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-700 px-4 py-2 rounded-md text-sm font-medium border border-gray-300 transition-colors"
        >
          Use different payment method
        </button>
      </div>

      {/* Security notice */}
      <div className="mt-4 text-xs text-gray-500 text-center">
        Your payment information is securely processed by Stripe
      </div>
    </div>
  )
}