'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { dollarsToCents } from '@/types/currency'
import { logger } from '@/lib/logging/logger'
import { calculateFirstInstallmentAmount } from '@/lib/payment-plan-utils'
import { PAYMENT_PLAN_INSTALLMENTS, INSTALLMENT_INTERVAL_DAYS } from '@/lib/services/payment-plan-config'

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
  /** Member chose a payment plan when joining (#442). */
  use_payment_plan?: boolean
  /** Member is payment-plan eligible now; if not, a plan choice is charged in full. */
  payment_plan_eligible?: boolean
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
  const [overridePrice, setOverridePrice] = useState(false)
  const [customPrice, setCustomPrice] = useState((waitlistEntry.base_price / 100).toFixed(2))
  const [priceError, setPriceError] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()

  const maxPrice = waitlistEntry.base_price / 100

  const handlePriceChange = (value: string) => {
    setCustomPrice(value)

    // Validate price
    const numValue = parseFloat(value)
    if (isNaN(numValue)) {
      setPriceError('Please enter a valid number')
    } else if (numValue < 0) {
      setPriceError('Price cannot be negative')
    } else if (numValue > maxPrice) {
      setPriceError(`Price cannot exceed $${maxPrice.toFixed(2)}`)
    } else {
      setPriceError(null)
    }
  }

  // Calculate display values based on override state
  const getDisplayPricing = () => {
    if (overridePrice && !priceError) {
      const numValue = parseFloat(customPrice)
      if (!isNaN(numValue) && numValue >= 0 && numValue <= maxPrice) {
        // Valid override: adjust base price, then apply discount
        const newBasePriceCents = Math.round(numValue * 100)

        // Calculate discount on the new base price
        let discountAmountCents = 0
        if (waitlistEntry.discount_code && waitlistEntry.discount_percentage) {
          discountAmountCents = Math.round((newBasePriceCents * waitlistEntry.discount_percentage) / 100)
        }

        const finalAmountCents = newBasePriceCents - discountAmountCents

        return {
          basePrice: newBasePriceCents,
          discountAmount: discountAmountCents,
          discountLabel: waitlistEntry.discount_code
            ? `Discount (${waitlistEntry.discount_code} - ${waitlistEntry.discount_percentage}%)`
            : null,
          finalAmount: finalAmountCents
        }
      }
    }

    // Default: show original pricing
    return {
      basePrice: waitlistEntry.base_price,
      discountAmount: waitlistEntry.discount_amount,
      discountLabel: waitlistEntry.discount_code
        ? `Discount (${waitlistEntry.discount_code} - ${waitlistEntry.discount_percentage}%)`
        : null,
      finalAmount: waitlistEntry.final_amount
    }
  }

  const displayPricing = getDisplayPricing()

  // Mirrors WaitlistPaymentService: the plan applies only if still eligible and there's
  // something to charge. Override price and discounts apply to the total before splitting.
  const chosePaymentPlan = waitlistEntry.use_payment_plan === true
  const willUsePaymentPlan = chosePaymentPlan && waitlistEntry.payment_plan_eligible === true && displayPricing.finalAmount > 0
  const planFallsBackToFull = chosePaymentPlan && !willUsePaymentPlan && displayPricing.finalAmount > 0
  const installmentAmount = calculateFirstInstallmentAmount(displayPricing.finalAmount)
  const chargeToday = willUsePaymentPlan ? installmentAmount : displayPricing.finalAmount

  const handleConfirmSelection = async () => {
    // Validate custom price if override is enabled
    if (overridePrice) {
      const numValue = parseFloat(customPrice)
      if (isNaN(numValue) || numValue < 0 || numValue > maxPrice) {
        showError('Invalid Price', 'Please enter a valid price')
        return
      }
    }

    setIsProcessing(true)

    try {
      const body = overridePrice ? {
        overridePrice: dollarsToCents(parseFloat(customPrice))
      } : {}

      const response = await fetch(`/api/waitlists/${waitlistEntry.id}/select`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to select user from waitlist')
      }

      showSuccess(
        'User Selected',
        data.userRegistration?.isPaymentPlan
          ? `${waitlistEntry.first_name} ${waitlistEntry.last_name} has been registered and charged the first payment-plan installment.`
          : `${waitlistEntry.first_name} ${waitlistEntry.last_name} has been successfully registered and charged.`
      )

      onSuccess()
    } catch (error) {
      logger.logPaymentProcessing('select-waitlist-user-error', 'Error selecting user from waitlist', { waitlistEntryId: waitlistEntry.id, error: error instanceof Error ? error.message : String(error) }, 'error')
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
                <span className="font-medium">${(displayPricing.basePrice / 100).toFixed(2)}</span>
              </div>

              {displayPricing.discountAmount > 0 && displayPricing.discountLabel && (
                <div className="flex justify-between text-sm text-purple-700">
                  <span>{displayPricing.discountLabel}:</span>
                  <span className="font-medium">-${(displayPricing.discountAmount / 100).toFixed(2)}</span>
                </div>
              )}

              {willUsePaymentPlan ? (
                <>
                  <div className="border-t pt-2 flex justify-between text-sm">
                    <span>Total:</span>
                    <span className="font-medium">${(displayPricing.finalAmount / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold">
                    <span>Charge Today (1 of {PAYMENT_PLAN_INSTALLMENTS}):</span>
                    <span className="text-green-600">${(chargeToday / 100).toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="border-t pt-2 flex justify-between text-base font-bold">
                  <span>Total to Charge:</span>
                  <span className="text-green-600">${(displayPricing.finalAmount / 100).toFixed(2)}</span>
                </div>
              )}
            </div>

            {willUsePaymentPlan && (
              <div className="mt-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                Member chose a payment plan. They&apos;ll be charged ${(chargeToday / 100).toFixed(2)} now, then{' '}
                {PAYMENT_PLAN_INSTALLMENTS - 1} more installments of about ${(installmentAmount / 100).toFixed(2)} every{' '}
                {INSTALLMENT_INTERVAL_DAYS} days.
              </div>
            )}

            {planFallsBackToFull && (
              <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                Member chose a payment plan but is no longer eligible (plan access turned off or no saved card).
                They&apos;ll be charged the full amount.
              </div>
            )}

            {/* Price Override Option */}
            <div className="mt-3 space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={overridePrice}
                  onChange={(e) => setOverridePrice(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">
                  Override price (e.g., mid-season join)
                </span>
              </label>

              {overridePrice && (
                <div className="ml-6 space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxPrice}
                      value={customPrice}
                      onChange={(e) => handlePriceChange(e.target.value)}
                      className={`flex-1 rounded-md border ${priceError ? 'border-red-300' : 'border-gray-300'} px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      placeholder="Enter custom price"
                    />
                  </div>
                  {priceError && (
                    <p className="text-xs text-red-600 ml-1">{priceError}</p>
                  )}
                  <p className="text-xs text-gray-500 ml-1">
                    Must be between $0.00 and ${maxPrice.toFixed(2)}
                  </p>
                </div>
              )}
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
                  This user&apos;s saved payment method will be charged {willUsePaymentPlan ? 'the first installment immediately, and the rest automatically on schedule' : 'immediately'}. A confirmation email will be sent to the user.
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
