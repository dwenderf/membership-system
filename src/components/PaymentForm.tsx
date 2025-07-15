'use client'

import { useState, useEffect } from 'react'
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'

// Force import client config
import '../../sentry.client.config'
import * as Sentry from '@sentry/nextjs'

interface PaymentFormProps {
  // For memberships
  membershipId?: string
  durationMonths?: number
  startDate?: Date
  endDate?: Date
  
  // For registrations
  registrationId?: string
  categoryId?: string
  
  // Common props
  amount: number
  userEmail: string
  onSuccess: () => void
  onError: (error: string) => void
  
  // Reservation timer (only for capacity-limited registrations)
  reservationExpiresAt?: string
  onTimerExpired?: () => void
  
  // Payment intent ID for status updates
  paymentIntentId?: string
}

export default function PaymentForm({
  membershipId,
  durationMonths,
  startDate,
  endDate,
  registrationId,
  categoryId,
  amount,
  userEmail,
  onSuccess,
  onError,
  reservationExpiresAt,
  onTimerExpired,
  paymentIntentId
}: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isLoading, setIsLoading] = useState(false)
  const [isElementsReady, setIsElementsReady] = useState(false)
  const [isFormComplete, setIsFormComplete] = useState(false)
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
      // Confirm payment with Stripe first to get payment intent
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: registrationId 
            ? `${window.location.origin}/user/registrations`
            : `${window.location.origin}/user/memberships`,
        },
        redirect: 'if_required',
      })

      // Update registration status to 'processing' with payment intent ID (for registrations only)
      if (!error && paymentIntent && registrationId && categoryId) {
        try {
          await fetch('/api/update-registration-status', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              registrationId: registrationId,
              categoryId: categoryId,
              status: 'processing',
              stripePaymentIntentId: paymentIntent.id
            }),
          })
        } catch (statusError) {
          console.warn('Failed to update registration status to processing:', statusError)
          // Continue anyway - the main flow should still work
        }
      }

      if (error) {
        // Capture payment failure as business event in Sentry
        Sentry.captureMessage(`Payment declined: ${error.message}`, {
          level: 'warning',
          tags: {
            payment_related: 'true',
            payment_failure: 'true',
            error_code: error.code,
            error_type: error.type
          },
          extra: {
            customer_email: userEmail,
            membership_id: membershipId,
            registration_id: registrationId,
            category_id: categoryId,
            duration_months: durationMonths,
            amount_cents: amount,
            stripe_error_code: error.code,
            stripe_error_type: error.type,
            stripe_error_message: error.message,
            decline_reason: error.decline_code || 'Not provided'
          }
        })
        
        // Update registration status to 'failed' for declined payments (registrations only)
        if (registrationId && categoryId) {
          try {
            await fetch('/api/update-registration-status', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                registrationId: registrationId,
                categoryId: categoryId,
                status: 'failed'
              }),
            })
          } catch (statusError) {
            console.warn('Failed to update registration status to failed:', statusError)
          }
        }

        // Update payment record status to 'failed' 
        // Use payment intent ID from either the error response or the prop passed from parent
        const intentId = (paymentIntent as any)?.id || paymentIntentId
        
        if (intentId) {
          try {
            await fetch('/api/update-payment-status', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                stripePaymentIntentId: intentId,
                status: 'failed'
              }),
            })
            console.log(`✅ Updated payment ${intentId} status to failed`)
          } catch (paymentError) {
            console.warn('Failed to update payment status to failed:', paymentError)
          }
        } else {
          console.warn('No payment intent ID available to update payment status to failed')
        }

        onError(error.message || 'Payment failed')
        return
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded, now create Xero invoice and then create the record
        const isRegistration = registrationId && categoryId
        
        // Create Xero invoice first
        try {
          const invoiceResponse = await fetch('/api/create-xero-invoice', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              paymentIntentId: paymentIntent.id,
              isRegistration: isRegistration
            }),
          })
          
          if (!invoiceResponse.ok) {
            const invoiceError = await invoiceResponse.json()
            console.warn('⚠️ Failed to create Xero invoice:', invoiceError)
            // Continue with record creation even if invoice fails
          } else {
            const invoiceData = await invoiceResponse.json()
            console.log('✅ Created Xero invoice:', invoiceData.invoiceNumber)
          }
        } catch (invoiceError) {
          console.warn('⚠️ Error creating Xero invoice:', invoiceError)
          // Continue with record creation even if invoice fails
        }
        
        // Now create the record (membership or registration)
        const endpoint = isRegistration 
          ? '/api/confirm-registration-payment'
          : '/api/confirm-payment'
        
        const body = isRegistration
          ? {
              paymentIntentId: paymentIntent.id, // Always use the actual successful payment intent ID
              categoryId: categoryId,
            }
          : {
              paymentIntentId: paymentIntent.id,
              startDate: startDate!.toISOString().split('T')[0], // YYYY-MM-DD format
              endDate: endDate!.toISOString().split('T')[0], // YYYY-MM-DD format
            }


        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errorData = await response.json()
          const recordType = isRegistration ? 'registration' : 'membership'
          onError(errorData.error || `Failed to create ${recordType}`)
          return
        }

        onSuccess()
      } else if (paymentIntent) {
        // Capture non-success payment status as business event
        Sentry.captureMessage(`Payment not completed - status: ${paymentIntent.status}`, {
          level: 'warning',
          tags: {
            payment_related: 'true',
            payment_status: paymentIntent.status,
            payment_intent_id: paymentIntent.id
          },
          extra: {
            customer_email: userEmail,
            membership_id: membershipId,
            registration_id: registrationId,
            category_id: categoryId,
            duration_months: durationMonths,
            amount_cents: amount,
            payment_intent_id: paymentIntent.id,
            payment_status: paymentIntent.status
          }
        })
        
        onError(`Payment ${paymentIntent.status}`)
      } else {
        onError('No payment intent returned')
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
      {/* Countdown Timer for capacity-limited registrations */}
      {timeLeft !== null && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
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