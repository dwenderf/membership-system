'use client'

import { useState } from 'react'
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
  buttonText = "Setup Payment Method",
  buttonClassName = "w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
}: PaymentMethodSetupProps) {
  const [showSetupForm, setShowSetupForm] = useState(false)
  const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showError } = useToast()

  const handleSetupClick = async () => {
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
      setShowSetupForm(true)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to setup payment method'
      setError(errorMessage)
      showError('Setup Error', errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setShowSetupForm(false)
    setSetupIntentClientSecret(null)
    setError(null)
    onCancel?.()
  }

  const handleSuccess = () => {
    setShowSetupForm(false)
    setSetupIntentClientSecret(null)
    setError(null)
    onSuccess?.()
  }

  const handleError = (error: string) => {
    setError(error)
    setShowSetupForm(false)
    setSetupIntentClientSecret(null)
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
        
        <button
          onClick={handleSetupClick}
          disabled={isLoading}
          className={buttonClassName}
        >
          {isLoading ? 'Setting up...' : buttonText}
        </button>

        {showSetupForm && setupIntentClientSecret && (
          <div className="mt-6">
            <Elements stripe={stripePromise} options={{ clientSecret: setupIntentClientSecret }}>
              <SetupIntentForm
                registrationName={registrationName || "Payment Method Setup"}
                alternatePrice={alternatePrice}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            </Elements>
          </div>
        )}
      </div>
    )
  }

  // Modal version
  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-red-800 text-sm">{error}</div>
        </div>
      )}
      
      <button
        onClick={handleSetupClick}
        disabled={isLoading}
        className={buttonClassName}
      >
        {isLoading ? 'Setting up...' : buttonText}
      </button>

      {showSetupForm && setupIntentClientSecret && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={handleClose}
        >
          <div 
            className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
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
            
            <Elements stripe={stripePromise} options={{ clientSecret: setupIntentClientSecret }}>
              <SetupIntentForm
                registrationName={registrationName || "Payment Method Setup"}
                alternatePrice={alternatePrice}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            </Elements>
          </div>
        </div>
      )}
    </>
  )
}