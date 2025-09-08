'use client'

import { useState } from 'react'
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js'
import { useToast } from '@/contexts/ToastContext'

interface SetupIntentFormProps {
  onSuccess: () => void
  onError: (error: string) => void
  registrationName: string
  alternatePrice: number | null
}

export default function SetupIntentForm({ 
  onSuccess, 
  onError, 
  registrationName,
  alternatePrice 
}: SetupIntentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const { showSuccess, showError } = useToast()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsProcessing(true)

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      onError('Card element not found')
      setIsProcessing(false)
      return
    }

    try {
      // Create Setup Intent
      const response = await fetch('/api/create-setup-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create setup intent')
      }

      const { clientSecret } = await response.json()

      // Confirm the Setup Intent
      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
        }
      })

      if (error) {
        throw new Error(error.message || 'Payment method setup failed')
      }

      if (setupIntent?.status === 'succeeded') {
        showSuccess(
          'Payment Method Saved!',
          'Your payment method has been securely saved for future alternate registrations.'
        )
        onSuccess()
      } else {
        throw new Error('Setup intent was not successful')
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      showError('Setup Failed', errorMessage)
      onError(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Authorization Warning */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <svg className="h-5 w-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div>
            <h4 className="text-sm font-medium text-blue-800 mb-2">
              Payment Authorization for Alternate Registration
            </h4>
            <div className="text-sm text-blue-700 space-y-2">
              <p>
                <strong>By saving your payment method, you authorize us to charge your card if you are selected as an alternate for any games.</strong>
              </p>
              <div className="bg-blue-100 rounded p-3 mt-3">
                <p className="font-medium">For {registrationName}:</p>
                <p>
                  • You'll only be charged if selected for specific games
                  {alternatePrice && (
                    <>• Charge amount: <strong>${(alternatePrice / 100).toFixed(2)} per game</strong></>
                  )}
                </p>
                <p>• You'll receive email notification when selected and charged</p>
                <p>• You can remove this authorization anytime from your account settings</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Payment Method
        </label>
        <div className="border border-gray-300 rounded-md p-3 bg-white">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#424770',
                  '::placeholder': {
                    color: '#aab7c4',
                  },
                },
                invalid: {
                  color: '#9e2146',
                },
              },
            }}
          />
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-md transition-colors"
      >
        {isProcessing ? 'Saving Payment Method...' : 'Save Payment Method & Register as Alternate'}
      </button>

      <div className="text-xs text-gray-500 text-center">
        Your payment information is securely processed by Stripe. We never store your card details.
      </div>
    </form>
  )
}