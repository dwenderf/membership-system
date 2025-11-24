'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatAmount } from '@/lib/format-utils'
import { formatDate } from '@/lib/date-utils'
import { useToast } from '@/contexts/ToastContext'
import ConfirmationDialog from './ConfirmationDialog'

interface Installment {
  planned_payment_date: string
  amount: number
}

interface PaymentPlan {
  invoice_id: string
  contact_id: string
  total_amount: number
  paid_amount: number
  total_installments: number
  installments_paid: number
  next_payment_date: string | null
  final_payment_date: string | null
  status: string
  registration_id: string | null
  registration_name: string | null
  season_name: string | null
  installments: Installment[]
}

export default function UserPaymentPlansSection() {
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [payingOff, setPayingOff] = useState<string | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<{ id: string; amount: number } | null>(null)
  const { showSuccess, showError } = useToast()
  const router = useRouter()

  useEffect(() => {
    fetchPaymentPlans()
  }, [])

  const fetchPaymentPlans = async () => {
    try {
      const response = await fetch('/api/user/payment-plans')

      if (!response.ok) {
        console.error('Error fetching payment plans:', response.statusText)
        return
      }

      const data = await response.json()
      setPaymentPlans(data.paymentPlans || [])
    } catch (error) {
      console.error('Error fetching payment plans:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePayRemainingClick = (planId: string, remainingAmount: number) => {
    setSelectedPlan({ id: planId, amount: remainingAmount })
    setShowConfirmModal(true)
  }

  const handleConfirmPayment = async () => {
    if (!selectedPlan) return

    setShowConfirmModal(false)
    setPayingOff(selectedPlan.id)

    try {
      const response = await fetch('/api/user/payment-plans/early-payoff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId: selectedPlan.id }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        showSuccess('Payment Successful', 'Your payment plan has been paid in full!')
        // Refresh the entire page to show updated status across all sections
        router.refresh()
      } else {
        showError('Payment Failed', data.error || 'Failed to process early payoff')
      }
    } catch (error) {
      console.error('Error paying off plan:', error)
      showError('Payment Failed', 'An unexpected error occurred')
    } finally {
      setPayingOff(null)
      setSelectedPlan(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Payment Plans</h2>
        </div>
        <div className="px-6 py-4">
          <div className="text-sm text-gray-500">Loading payment plans...</div>
        </div>
      </div>
    )
  }

  if (paymentPlans.length === 0) {
    return null // Don't show section if no active plans
  }

  return (
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Payment Plans</h2>
        <p className="mt-1 text-sm text-gray-600">
          Active payment plans for your registrations
        </p>
      </div>
      <div className="px-6 py-4">
        <div className="space-y-4">
          {paymentPlans.map((plan) => {
            const remainingBalance = plan.total_amount - plan.paid_amount
            const registrationName = plan.registration_name || 'Unknown Registration'
            const seasonName = plan.season_name

            return (
              <div key={plan.invoice_id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{registrationName}</h3>
                    {seasonName && (
                      <p className="text-xs text-gray-500">{seasonName}</p>
                    )}
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Active
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Progress: {plan.installments_paid} of {plan.total_installments} payments</span>
                    <span>{Math.round((plan.paid_amount / plan.total_amount) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(plan.paid_amount / plan.total_amount) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Financial Details */}
                <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
                  <div>
                    <span className="text-gray-500">Total:</span>
                    <div className="font-medium">{formatAmount(plan.total_amount)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Paid:</span>
                    <div className="font-medium text-green-600">{formatAmount(plan.paid_amount)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Remaining:</span>
                    <div className="font-medium text-orange-600">{formatAmount(remainingBalance)}</div>
                  </div>
                </div>

                {/* Next Payment */}
                {plan.next_payment_date && plan.installments && (
                  <div className="mb-3 p-2 bg-gray-50 rounded text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Next Payment:</span>
                      <span className="font-medium">{formatDate(new Date(plan.next_payment_date))}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-gray-600">Amount:</span>
                      <span className="font-medium">
                        {formatAmount(
                          plan.installments.find((i) => i.planned_payment_date === plan.next_payment_date)?.amount || 0
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Pay Remaining Button */}
                {remainingBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => handlePayRemainingClick(plan.invoice_id, remainingBalance)}
                    disabled={payingOff === plan.invoice_id}
                    className={`w-full px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      payingOff === plan.invoice_id
                        ? 'bg-gray-400 text-white cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {payingOff === plan.invoice_id
                      ? 'Processing...'
                      : `Pay Remaining Balance (${formatAmount(remainingBalance)})`
                    }
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Information Box */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-blue-700">
              <p>Automatic payments are processed monthly using your saved payment method.</p>
              <p className="mt-1">You can pay the remaining balance early at any time with no penalty.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationDialog
        isOpen={showConfirmModal}
        title="Confirm Payment"
        message={
          <div className="space-y-4">
            <p>
              Are you sure you want to pay the remaining balance of:
            </p>
            <p className="text-center text-2xl font-bold text-gray-900">
              {selectedPlan ? formatAmount(selectedPlan.amount) : ''}
            </p>
            <p className="text-sm text-gray-600">
              This will immediately charge your saved payment method and complete your payment plan.
            </p>
          </div>
        }
        confirmText="Pay Now"
        cancelText="Cancel"
        onConfirm={handleConfirmPayment}
        onCancel={() => setShowConfirmModal(false)}
        variant="info"
      />
    </div>
  )
}
