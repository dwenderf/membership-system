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
  const [showManageModal, setShowManageModal] = useState(false)
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

  const handleManageClick = () => {
    setShowManageModal(true)
  }

  const handleRemoveClick = () => {
    setShowManageModal(false)
    setShowConfirmDialog(true)
  }

  const handleUpdateClick = () => {
    setShowManageModal(false)
    setShowSetup(true)
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
        {paymentMethod && !showSetup ? (
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
                onClick={handleManageClick}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors min-w-[120px]"
              >
                Manage
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
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{paymentMethod ? 'Update' : 'Add'} Payment Method</h3>
                    <p className="text-sm text-gray-500">
                      {paymentMethod
                        ? 'Your new payment method will replace the existing one. Your alternate registrations will remain active.'
                        : 'Save a payment method for alternate registrations and future transactions.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSetup(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <PaymentMethodSetup
                  showModal={false}
                  title={paymentMethod ? 'Update Payment Method' : 'Save Payment Method'}
                  description={paymentMethod
                    ? 'Your new payment method will replace the existing one.'
                    : 'Save a payment method for alternate registrations and future transactions.'}
                  buttonText={paymentMethod ? 'Update Payment Method' : 'Save Payment Method'}
                  isUpdate={!!paymentMethod}
                  onSuccess={() => {
                    setShowSetup(false)
                    showSuccess(
                      paymentMethod ? 'Payment Method Updated' : 'Payment Method Saved',
                      paymentMethod
                        ? 'Your payment method was updated successfully. Your alternate registrations remain active.'
                        : 'Your payment method was saved successfully.'
                    )
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

      {/* Manage Modal */}
      <ConfirmationDialog
        isOpen={showManageModal}
        title="Manage Payment Method"
        message={
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Choose an action for your saved payment method:
            </p>
            <div className="space-y-3">
              <button
                onClick={handleUpdateClick}
                className="w-full flex items-center justify-between p-4 border border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900">Update Payment Method</div>
                    <div className="text-xs text-gray-500">Replace with a new card (keeps alternate registrations)</div>
                  </div>
                </div>
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                onClick={handleRemoveClick}
                className="w-full flex items-center justify-between p-4 border border-gray-300 rounded-lg hover:border-red-500 hover:bg-red-50 transition-colors"
              >
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-red-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900">Remove Payment Method</div>
                    <div className="text-xs text-gray-500">Delete entirely (removes from alternate registrations)</div>
                  </div>
                </div>
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        }
        confirmText=""
        onConfirm={() => {}}
        onCancel={() => setShowManageModal(false)}
        hideButtons={true}
      />

      {/* Remove Confirmation Dialog */}
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
