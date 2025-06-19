'use client'

import { useState, useEffect } from 'react'
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'

interface PaymentFormProps {
  membershipId: string
  durationMonths: number
  amount: number
  startDate: Date
  endDate: Date
  userEmail: string
  onSuccess: () => void
  onError: (error: string) => void
}

export default function PaymentForm({
  membershipId,
  durationMonths,
  amount,
  startDate,
  endDate,
  userEmail,
  onSuccess,
  onError
}: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isLoading, setIsLoading] = useState(false)
  const [isElementsReady, setIsElementsReady] = useState(false)
  
  const [isFormComplete, setIsFormComplete] = useState(false)

  // Check if Elements are ready for form validation
  useEffect(() => {
    if (!elements) return

    const checkElementsReady = async () => {
      const paymentElement = elements.getElement('payment')
      if (paymentElement) {
        // Elements are loaded and ready
        setIsElementsReady(true)
      }
    }

    // Check immediately and set up a timeout as fallback
    checkElementsReady()
    const timeoutId = setTimeout(() => {
      setIsElementsReady(true) // Fallback after 3 seconds
    }, 3000)

    return () => clearTimeout(timeoutId)
  }, [elements])

  // Form completion is now handled via PaymentElement onChange prop

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!stripe || !elements || !isFormComplete) {
      return
    }

    setIsLoading(true)

    try {
      // Confirm payment with Stripe
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/user/memberships`,
        },
        redirect: 'if_required',
      })

      if (error) {
        onError(error.message || 'Payment failed')
        return
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded, now create the membership record
        const response = await fetch('/api/confirm-payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            paymentIntentId: paymentIntent.id,
            startDate: startDate.toISOString().split('T')[0], // YYYY-MM-DD format
            endDate: endDate.toISOString().split('T')[0], // YYYY-MM-DD format
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          onError(errorData.error || 'Failed to create membership')
          return
        }

        onSuccess()
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  // Loading skeleton for payment form
  const PaymentFormSkeleton = () => (
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
  )

  if (!stripe || !elements) {
    return (
      <div className="space-y-4">
        <div className="text-center text-sm text-gray-500 mb-4">
          Loading payment form...
        </div>
        <PaymentFormSkeleton />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!isElementsReady ? (
        <div className="space-y-4">
          <div className="text-center text-sm text-gray-500 mb-4">
            Preparing secure payment form...
          </div>
          <PaymentFormSkeleton />
        </div>
      ) : (
        <>
          <PaymentElement 
            options={{
              defaultValues: {
                billingDetails: {
                  email: userEmail,
                },
              },
            }}
            onReady={() => {
              setIsElementsReady(true)
            }}
            onChange={(event) => {
              setIsFormComplete(event.complete === true)
            }}
          />
          
          <button
            type="submit"
            disabled={!stripe || !elements || !isElementsReady || !isFormComplete || isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {isLoading 
              ? 'Processing Payment...' 
              : !isFormComplete 
              ? 'Complete form to continue'
              : `Pay $${(amount / 100).toFixed(2)}`
            }
          </button>
        </>
      )}
    </form>
  )
}