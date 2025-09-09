'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import PaymentMethodSetup from './PaymentMethodSetup'

interface PaymentMethod {
  id: string
  card: {
    brand: string
    last4: string
    exp_month: number
    exp_year: number
  }
}

export default function PaymentMethodManager() {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(false)
  const { showSuccess, showError } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadPaymentMethod()
  }, [])

  const loadPaymentMethod = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const response = await fetch('/api/user-payment-method')
      if (response.ok) {
        const data = await response.json()
        setPaymentMethod(data.paymentMethod)
      }
    } catch (error) {
      console.error('Error loading payment method:', error)
    } finally {
      setLoading(false)
    }
  }

  const removePaymentMethod = async () => {
    if (!paymentMethod) return

    setRemoving(true)
    try {
      const response = await fetch('/api/remove-payment-method', {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to remove payment method')
      }

      setPaymentMethod(null)
      showSuccess(
        'Payment Method Removed',
        'Your payment method has been removed. You\'ve been removed from all alternate registrations.'
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred'
      showError('Removal Failed', errorMessage)
    } finally {
      setRemoving(false)
    }
  }

  const confirmRemoval = () => {
    if (window.confirm(
      'Are you sure you want to remove your payment method? This will also remove you from all alternate registrations.'
    )) {
      removePaymentMethod()
    }
  }

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Method</h3>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Method</h3>
      
      {paymentMethod ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0">
                <svg className="h-8 w-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm0 2h12v8H4V6z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {paymentMethod.card.brand.toUpperCase()} •••• {paymentMethod.card.last4}
                </div>
                <div className="text-sm text-gray-500">
                  Expires {paymentMethod.card.exp_month.toString().padStart(2, '0')}/{paymentMethod.card.exp_year}
                </div>
              </div>
            </div>
            <button
              onClick={confirmRemoval}
              disabled={removing}
              className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
            >
              {removing ? 'Removing...' : 'Remove'}
            </button>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-blue-700">
                <p className="font-medium mb-1">Payment Authorization Active</p>
                <p>This payment method is authorized for alternate registration charges. You'll be notified by email when charged.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-6">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No payment method saved</h3>
          <p className="mt-1 text-sm text-gray-500 mb-4">
            Save a payment method to register as an alternate for events.
          </p>
          
          <PaymentMethodSetup
            title="Save Payment Method"
            description="Save a payment method for alternate registrations and future transactions."
            showModal={false}
            buttonText="Add Payment Method"
            buttonClassName="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
            onSuccess={() => {
              loadPaymentMethod() // Reload to show the new payment method
            }}
          />
        </div>
      )}
    </div>
  )
}