'use client'

import { useState, useEffect } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe-client'
import SetupIntentForm from './SetupIntentForm'
import { useToast } from '@/contexts/ToastContext'

interface PaymentMethodSetupProps {
  onSuccess?: () => void
  onCancel?: () => void
  title?: string
  description?: string
  registrationName?: string
  alternatePrice?: number | null
  showModal?: boolean
  buttonText?: string
  buttonClassName?: string
}

export default function PaymentMethodSetup({
  onSuccess,
  onCancel,
  title = "Setup Payment Method",
  description = "Save a payment method for future transactions",
  registrationName,
  alternatePrice,
  showModal = true,
  buttonText = "Save Payment Method",
  buttonClassName = "w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
}: PaymentMethodSetupProps) {
  const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { showError } = useToast()

  // Automatically create setup intent when component mounts
  useEffect(() => {
    const createSetupIntent = async () => {
      setIsLoading(true)
      setError(null)

      try {
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
        setSetupIntentClientSecret(clientSecret)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to setup payment method'
        setError(errorMessage)
        showError('Setup Error', errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    createSetupIntent()
  }, [showError])

  const handleClose = () => {
    onCancel?.()
  }

  const handleSuccess = () => {
    onSuccess?.()
  }

  const handleError = (error: string) => {
    setError(error)
  }

  // If not showing as modal, render inline
  if (!showModal) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}
        
        {isLoading ? (
          <div className="text-center py-4">
            <div className="text-sm text-gray-500">Setting up secure payment...</div>
          </div>
        ) : setupIntentClientSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret: setupIntentClientSecret }}>
            <SetupIntentForm
              registrationName={registrationName || "Payment Method Setup"}
              alternatePrice={alternatePrice ?? 0}
              onSuccess={handleSuccess}
              onError={handleError}
              buttonText={buttonText}
            />
          </Elements>
        ) : null}
      </div>
    )
  }

  // Modal version with transparent background
  return (
    <div 
      className="fixed inset-0 bg-gray-500 bg-opacity-25 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={handleClose}
    >
      <div 
        className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <span className="sr-only">Close</span>
            ✕
          </button>
        </div>
        
        {description && (
          <p className="text-sm text-gray-600 mb-4">{description}</p>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}
        
        {isLoading ? (
          <div className="text-center py-8">
            <div className="text-sm text-gray-500">Setting up secure payment...</div>
          </div>
        ) : setupIntentClientSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret: setupIntentClientSecret }}>
            <SetupIntentForm
              registrationName={registrationName || "Payment Method Setup"}
              alternatePrice={alternatePrice ?? 0}
              onSuccess={handleSuccess}
              onError={handleError}
              buttonText={buttonText}
            />
          </Elements>
        ) : null}
      </div>
    </div>
  )
}