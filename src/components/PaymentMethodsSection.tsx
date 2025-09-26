'use client'

import { useEffect, useMemo, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import PaymentMethodSetup from './PaymentMethodSetup'
import ConfirmationDialog from './ConfirmationDialog'
import { formatPaymentMethodDescription } from '@/lib/payment-method-utils'

interface PaymentMethod {
  id: string
  card: {
    brand: string
    last4: string
    exp_month: number
    exp_year: number
  }
}

export default function PaymentMethodsSection() {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [alternateRegs, setAlternateRegs] = useState<any[]>([])
  const { showSuccess, showError } = useToast()

  const loadPaymentMethod = async (): Promise<PaymentMethod | null> => {
    try {
      const response = await fetch('/api/user-payment-method')
      if (response.ok) {
        const data = await response.json()
        setPaymentMethod(data.paymentMethod)
        return data.paymentMethod
      } else {
        setPaymentMethod(null)
        return null
      }
    } catch (error) {
      console.error('Error loading payment method:', error)
      setPaymentMethod(null)
      return null
    }
  }

  const loadAlternateRegistrations = async () => {
    try {
      const response = await fetch('/api/user-alternate-registrations')
      if (response.ok) {
        const data = await response.json()
        setAlternateRegs(data || [])
      } else {
        setAlternateRegs([])
      }
    } catch (error) {
      console.error('Error loading alternate registrations:', error)
      setAlternateRegs([])
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([loadPaymentMethod(), loadAlternateRegistrations()])
      setLoading(false)
    }
    init()
  }, [])

  const activeAlternateCount = useMemo(() => {
    const now = new Date()
    return alternateRegs.filter((alt) => {
      const end = alt?.registration?.season?.end_date
      if (!end) return false
      const endDate = new Date(end)
      return endDate >= now
    }).length
  }, [alternateRegs])

  const handleRemoveClick = () => {
    setShowConfirmDialog(true)
  }

  const handleConfirmRemove = async () => {
    if (!paymentMethod) return

    setRemoving(true)
    try {
      const response = await fetch('/api/remove-payment-method', {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to remove payment method')
      }

      showSuccess('Payment Method Removed', activeAlternateCount > 0
        ? 'Your payment method was removed and you were removed from your active alternate registrations.'
        : 'Your payment method was removed successfully.'
      )

      // Optimistically update UI; webhook will sync DB
      setPaymentMethod(null)
      setAlternateRegs([])
      setShowConfirmDialog(false)
      // Optionally refresh once after webhook has time to process
      setTimeout(() => { void loadPaymentMethod(); void loadAlternateRegistrations() }, 1000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      showError('Removal Failed', message)
    } finally {
      setRemoving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Payment Methods</h2>
          <p className="mt-1 text-sm text-gray-600">Manage your saved payment method for alternate registrations</p>
        </div>
        <div className="px-6 py-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            <div className="h-10 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Payment Methods</h2>
        <p className="mt-1 text-sm text-gray-600">Manage your saved payment method for alternate registrations</p>
      </div>

      <div className="px-6 py-6">
        {paymentMethod ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <svg className="h-8 w-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm0 2h12v8H4V6z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {formatPaymentMethodDescription(paymentMethod.card)}
                  </div>
                  <div className="text-sm text-gray-500">
                    Expires {paymentMethod.card.exp_month.toString().padStart(2, '0')}/{paymentMethod.card.exp_year}
                  </div>
                </div>
              </div>
              <button
                onClick={handleRemoveClick}
                disabled={removing}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>

            {activeAlternateCount > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <svg className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-blue-700">
                    <p className="font-medium mb-1">Alternate Registration Notice</p>
                    <p>You currently have {activeAlternateCount} active alternate registration{activeAlternateCount !== 1 ? 's' : ''}. Removing your payment method will remove you from those alternates.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            {!showSetup ? (
              <div className="text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No payment method saved</h3>
                <p className="mt-1 text-sm text-gray-500 mb-4">
                  Save a payment method to register as an alternate for events.
                </p>
                <button
                  onClick={() => setShowSetup(true)}
                  className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-800 bg-blue-100 hover:bg-blue-200 hover:border-blue-400 transition-colors"
                >
                  Add Payment Method
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-900">Add Payment Method</h3>
                  <p className="text-sm text-gray-500">Save a payment method for alternate registrations and future transactions.</p>
                </div>
                <PaymentMethodSetup
                  showModal={false}
                  title="Save Payment Method"
                  description="Save a payment method for alternate registrations and future transactions."
                  buttonText="Save Payment Method"
                  onSuccess={() => {
                    setShowSetup(false)
                    showSuccess('Payment Method Saved', 'Your payment method was saved successfully.')
                    // Allow webhook to persist, then refresh once
                    setTimeout(() => { void loadPaymentMethod() }, 1000)
                  }}
                  onCancel={() => setShowSetup(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmationDialog
        isOpen={showConfirmDialog}
        title="Remove Payment Method?"
        message={
          <div className="space-y-3">
            <p>
              Are you sure you want to remove your saved payment method?
            </p>
            <p>
              Removing your payment method will also remove you from any teams you are registered for as an alternate.
            </p>
            {activeAlternateCount > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <div className="flex items-start">
                  <svg className="h-5 w-5 text-orange-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-orange-700">
                    <p className="font-medium">Warning:</p>
                    <p>You currently have {activeAlternateCount} active alternate registration{activeAlternateCount !== 1 ? 's' : ''}. Removing your payment method will also remove you from those alternate lists.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        }
        confirmText="Remove Payment Method"
        onConfirm={handleConfirmRemove}
        onCancel={() => setShowConfirmDialog(false)}
        isLoading={removing}
        variant="danger"
      />
    </div>
  )
}
