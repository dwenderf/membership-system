'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface RegistrationRefundModalProps {
  registration: {
    id: string
    user_id: string
    first_name: string
    last_name: string
    category_name: string
    amount_paid: number
    payment_id: string | null
    invoice_number: string | null
  }
  registrationName: string
  onCancel: () => void
}

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function RegistrationRefundModal({
  registration,
  registrationName,
  onCancel
}: RegistrationRefundModalProps) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const handleContinue = () => {
    if (!reason.trim()) {
      setError('Please provide a reason for the refund')
      return
    }

    if (!registration.payment_id) {
      setError('Payment ID not found for this registration')
      return
    }

    // Navigate to the user's invoice detail page
    // We'll use the user_id to construct the URL
    const invoiceUrl = `/admin/reports/users/${registration.user_id}/invoices/${registration.payment_id}?openRefund=true`
    router.push(invoiceUrl)
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Process Refund</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Registration Info */}
        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <div className="text-sm text-gray-600">
            <div className="font-medium text-gray-900">
              {registration.first_name} {registration.last_name}
            </div>
            <div className="mt-1">{registrationName}</div>
            <div>Category: {registration.category_name}</div>
            <div className="mt-2 font-semibold text-gray-900">
              Amount Paid: {formatAmount(registration.amount_paid)}
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="text-xs text-yellow-800">
              <div className="font-semibold">This action will:</div>
              <ul className="mt-1 list-disc list-inside space-y-1">
                <li>Process a full refund via Stripe</li>
                <li>Mark registration as &quot;refunded&quot;</li>
                <li>Remove user from active roster</li>
                <li>Free up capacity for others</li>
                <li>Create credit note in Xero</li>
              </ul>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="text-sm text-red-600">{error}</div>
          </div>
        )}

        {/* Reason */}
        <div className="mb-6">
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
            Reason for Refund <span className="text-red-500">*</span>
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setError('')
            }}
            rows={3}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Explain why this refund is being processed..."
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!reason.trim()}
          >
            Continue to Refund Details
          </button>
        </div>
      </div>
    </div>
  )
}
