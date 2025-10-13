'use client'

import { useState } from 'react'
import { useStripe, useElements, CardNumberElement, CardExpiryElement, CardCvcElement } from '@stripe/react-stripe-js'
import { useToast } from '@/contexts/ToastContext'

interface SetupIntentFormProps {
  onSuccess: () => void
  onError: (error: string) => void
  registrationName: string
  alternatePrice: number | null
  buttonText?: string
  isUpdate?: boolean
}

export default function SetupIntentForm({
  onSuccess,
  onError,
  registrationName,
  alternatePrice,
  buttonText = "Save Payment Method",
  isUpdate = false
}: SetupIntentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [postalCode, setPostalCode] = useState('')
  const [cardNumberComplete, setCardNumberComplete] = useState(false)
  const [cardExpiryComplete, setCardExpiryComplete] = useState(false)
  const [cardCvcComplete, setCardCvcComplete] = useState(false)
  const { showSuccess, showError } = useToast()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    console.log('💳 Setup intent form submit started', { isUpdate })

    if (!stripe || !elements) {
      console.log('❌ Stripe or elements not ready')
      return
    }

    setIsProcessing(true)

    const cardNumberElement = elements.getElement(CardNumberElement)
    if (!cardNumberElement) {
      console.log('❌ Card number element not found')
      onError('Card details not found')
      setIsProcessing(false)
      return
    }

    try {
      console.log('💳 Confirming setup intent...')
      // Fetch the clientSecret from your backend
      const response = await fetch('/api/create-setup-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ registrationName }),
      })
      if (!response.ok) {
        throw new Error('Failed to create Setup Intent')
      }
      const data = await response.json()
      const clientSecret = data.clientSecret
      if (!clientSecret) {
        throw new Error('No client secret returned from backend')
      }

      const { error, setupIntent } = await stripe.confirmCardSetup(
        clientSecret,
        {
          payment_method: {
            card: cardNumberElement,
            billing_details: {
              address: {
                postal_code: postalCode || undefined,
              },
            },
          },
        }
      )

      if (error) {
        throw new Error(error.message || 'Payment method setup failed')
      }

      if (setupIntent?.status === 'succeeded') {
        console.log('✅ Setup intent succeeded:', setupIntent.id)

        // Persist immediately to avoid relying on webhook timing
        try {
          console.log('💳 Confirming setup intent in backend...', { setupIntentId: setupIntent.id, isUpdate })
          const confirmResponse = await fetch('/api/confirm-setup-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ setupIntentId: setupIntent.id, isUpdate })
          })

          if (!confirmResponse.ok) {
            const errorData = await confirmResponse.json()
            console.error('❌ Failed to confirm setup intent:', errorData)
            throw new Error(errorData.error || 'Failed to confirm setup intent')
          }

          console.log('✅ Setup intent confirmed in backend')
        } catch (persistErr) {
          console.error('❌ Failed to confirm setup intent:', persistErr)
          throw persistErr
        }

        showSuccess(
          isUpdate ? 'Payment Method Updated!' : 'Payment Method Saved!',
          isUpdate
            ? 'Your payment method has been updated successfully.'
            : 'Your payment method has been securely saved for future alternate registrations.'
        )
        console.log('✅ Calling onSuccess callback')
        onSuccess()
      } else {
        console.log('❌ Setup intent status:', setupIntent?.status)
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
      {/* Authorization Warning - only show for alternate registrations */}
      {alternatePrice !== null && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-blue-800 mb-2">
                Payment Authorization for Alternate Registration
              </h4>
              <div className="text-sm text-blue-700 space-y-1">
                <p>
                  <strong>By saving your payment method, you authorize us to charge your card if you are selected as an alternate.</strong>
                </p>
                <p>You can remove this authorization anytime from your account settings.</p>
                              </div>
            </div>
          </div>
        </div>
      )}

      {/* Card Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Payment Method
        </label>
        <div className="space-y-3">
          <div className="border border-gray-300 rounded-md p-3 bg-white">
            <CardNumberElement
              onChange={(e) => setCardNumberComplete(e.complete)}
              options={{
                disableLink: true,
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-gray-300 rounded-md p-3 bg-white">
              <CardExpiryElement
                onChange={(e) => setCardExpiryComplete(e.complete)}
                options={{
                  style: {
                    base: { fontSize: '16px', color: '#424770' },
                    invalid: { color: '#9e2146' },
                  },
                }}
              />
            </div>
            <div className="border border-gray-300 rounded-md p-3 bg-white">
              <CardCvcElement
                onChange={(e) => setCardCvcComplete(e.complete)}
                options={{
                  style: {
                    base: { fontSize: '16px', color: '#424770' },
                    invalid: { color: '#9e2146' },
                  },
                }}
              />
            </div>
            <div>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="Postal Code"
                className="w-full border border-gray-300 rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Your payment information is securely processed by Stripe. We never store your card details.
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!stripe || isProcessing || !cardNumberComplete || !cardExpiryComplete || !cardCvcComplete || postalCode.trim().length === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-md transition-colors"
      >
        {isProcessing ? 'Saving Payment Method...' : buttonText}
      </button>

          </form>
  )
}