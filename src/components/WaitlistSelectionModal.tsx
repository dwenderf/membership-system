'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface WaitlistEntry {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  category_name: string
  base_price: number
  discount_amount: number
  final_amount: number
  discount_code: string | null
  discount_percentage: number | null
}

interface WaitlistSelectionModalProps {
  waitlistEntry: WaitlistEntry
  registrationName: string
  onSuccess: () => void
  onCancel: () => void
}

export default function WaitlistSelectionModal({
  waitlistEntry,
  registrationName,
  onSuccess,
  onCancel
}: WaitlistSelectionModalProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const { showSuccess, showError } = useToast()

  const handleConfirmSelection = async () => {
    setIsProcessing(true)

    try {
      const response = await fetch(`/api/waitlists/${waitlistEntry.id}/select`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to select user from waitlist')
      }

      showSuccess(
        'User Selected',
        `${waitlistEntry.first_name} ${waitlistEntry.last_name} has been successfully registered and charged.`
      )

      onSuccess()
    } catch (error) {
      console.error('Error selecting user from waitlist:', error)
      showError(
        'Selection Failed',
        error instanceof Error ? error.message : 'Failed to select user from waitlist'
      )
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Confirm Waitlist Selection
        </h3>

        <div className="space-y-4 mb-6">
          {/* User Information */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">User Information</h4>
            <div className="bg-gray-50 rounded-md p-3 space-y-1">
              <div className="text-sm">
                <span className="font-medium">Name:</span> {waitlistEntry.first_name} {waitlistEntry.last_name}
              </div>
              <div className="text-sm">
                <span className="font-medium">Email:</span> {waitlistEntry.email}
              </div>
            </div>
          </div>

          {/* Registration Information */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Registration Details</h4>
            <div className="bg-gray-50 rounded-md p-3 space-y-1">
              <div className="text-sm">
                <span className="font-medium">Event/Team:</span> {registrationName}
              </div>
              <div className="text-sm">
                <span className="font-medium">Category:</span> {waitlistEntry.category_name}
              </div>
            </div>
          </div>

          {/* Pricing Breakdown */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Pricing Breakdown</h4>
            <div className="bg-gray-50 rounded-md p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Base Price:</span>
                <span className="font-medium">${(waitlistEntry.base_price / 100).toFixed(2)}</span>
              </div>

              {waitlistEntry.discount_amount > 0 && waitlistEntry.discount_code && (
                <div className="flex justify-between text-sm text-purple-700">
                  <span>Discount ({waitlistEntry.discount_code} - {waitlistEntry.discount_percentage}%):</span>
                  <span className="font-medium">-${(waitlistEntry.discount_amount / 100).toFixed(2)}</span>
                </div>
              )}

              <div className="border-t pt-2 flex justify-between text-base font-bold">
                <span>Total to Charge:</span>
                <span className="text-green-600">${(waitlistEntry.final_amount / 100).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Warning Message */}
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  This user's saved payment method will be charged immediately. A confirmation email will be sent to the user.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmSelection}
            disabled={isProcessing}
            className="inline-flex justify-center rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Confirm & Charge'}
          </button>
        </div>
      </div>
    </div>
  )
}
