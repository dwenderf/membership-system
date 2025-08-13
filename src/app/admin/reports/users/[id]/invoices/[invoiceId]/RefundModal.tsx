'use client'

import { useState, useEffect } from 'react'
import { formatAmount } from '@/lib/format-utils'

type RefundType = 'proportional' | 'discount_code'

interface DiscountValidation {
  isValid: boolean
  discountCode?: {
    id: string
    code: string
    percentage: number
    category: {
      id: string
      name: string
      accounting_code: string
      max_discount_per_user_per_season: number | null
    }
  }
  discountAmount?: number
  isPartialDiscount?: boolean
  partialDiscountMessage?: string
  error?: string
}

interface RefundModalProps {
  paymentId: string
  availableAmount: number
  paymentAmount: number
  invoiceNumber: string
}

export default function RefundModal({ 
  paymentId, 
  availableAmount, 
  paymentAmount, 
  invoiceNumber 
}: RefundModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [refundType, setRefundType] = useState<RefundType>('proportional')
  const [refundAmount, setRefundAmount] = useState('')
  const [discountCode, setDiscountCode] = useState('')
  const [discountValidation, setDiscountValidation] = useState<DiscountValidation | null>(null)
  const [isValidatingDiscount, setIsValidatingDiscount] = useState(false)
  const [reason, setReason] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const openModal = () => {
    setIsOpen(true)
    setRefundType('proportional')
    setRefundAmount('')
    setDiscountCode('')
    setDiscountValidation(null)
    setReason('')
    setError('')
    setSuccess('')
  }

  const closeModal = () => {
    setIsOpen(false)
    setRefundType('proportional')
    setRefundAmount('')
    setDiscountCode('')
    setDiscountValidation(null)
    setReason('')
    setError('')
    setSuccess('')
  }

  const validateDiscountCode = async (code: string) => {
    if (!code.trim()) {
      setDiscountValidation(null)
      return
    }

    setIsValidatingDiscount(true)
    setError('')

    try {
      // First, get the registration associated with this payment
      // Since a payment can have multiple registrations, we'll use the first one for season context
      const registrationResponse = await fetch(`/api/admin/payments/${paymentId}/registrations`)
      
      if (!registrationResponse.ok) {
        throw new Error('Failed to fetch registration information')
      }
      
      const registrationData = await registrationResponse.json()
      
      if (!registrationData.registrations || registrationData.registrations.length === 0) {
        throw new Error('No registration found for this payment')
      }

      // Use the first registration for season context
      const registrationId = registrationData.registrations[0].registration_id

      // Use existing discount validation endpoint
      const response = await fetch('/api/validate-discount-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: code.trim(),
          registrationId: registrationId,
          amount: paymentAmount // Original payment amount
        })
      })

      const result = await response.json()
      setDiscountValidation(result)

      // Show all validation messages in main error area to prevent form jumping
      if (result.isValid) {
        if (result.isPartialDiscount && result.partialDiscountMessage) {
          setError(result.partialDiscountMessage)
        } else {
          setError('') // Clear any previous errors
        }
      } else {
        // Show validation error in main error area
        setError(result.error || 'Failed to validate discount code')
      }
    } catch (err) {
      setDiscountValidation({
        isValid: false,
        error: 'Failed to validate discount code'
      })
      // Also show error in main error area
      setError(err instanceof Error ? err.message : 'Failed to validate discount code')
    } finally {
      setIsValidatingDiscount(false)
    }
  }

  // Debounced discount code validation using useEffect
  useEffect(() => {
    if (discountCode && refundType === 'discount_code') {
      const timeoutId = setTimeout(() => {
        validateDiscountCode(discountCode)
      }, 500) // Debounce validation by 500ms
      
      return () => clearTimeout(timeoutId)
    } else {
      setDiscountValidation(null)
    }
  }, [discountCode, refundType, paymentId, paymentAmount])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsProcessing(true)

    try {
      // Validate amount
      const amountInCents = Math.round(parseFloat(refundAmount) * 100)
      
      if (isNaN(amountInCents) || amountInCents <= 0) {
        setError('Please enter a valid refund amount')
        return
      }

      if (amountInCents > availableAmount) {
        setError(`Refund amount cannot exceed ${formatAmount(availableAmount)}`)
        return
      }

      // Process refund
      const response = await fetch('/api/admin/refunds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentId,
          amount: amountInCents,
          reason: reason.trim()
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process refund')
      }

      setSuccess(`Refund of ${formatAmount(amountInCents)} processed successfully`)
      
      // Refresh the page after successful refund
      setTimeout(() => {
        window.location.reload()
      }, 2000)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFullRefund = () => {
    setRefundAmount((availableAmount / 100).toFixed(2))
  }

  // Validate refund amount in real-time
  const isValidAmount = () => {
    const amountInCents = Math.round(parseFloat(refundAmount) * 100)
    return !isNaN(amountInCents) && amountInCents > 0 && amountInCents <= availableAmount
  }

  // Validate that reason is provided
  const isValidReason = () => {
    return reason.trim().length > 0
  }

  // Get effective refund amount based on type
  const getEffectiveRefundAmount = () => {
    if (refundType === 'discount_code' && discountValidation?.isValid) {
      return discountValidation.discountAmount || 0
    }
    return Math.round(parseFloat(refundAmount) * 100)
  }

  // Check if form is valid for submission
  const isFormValid = () => {
    const hasValidReason = isValidReason()
    
    if (refundType === 'proportional') {
      return isValidAmount() && hasValidReason
    } else {
      return discountValidation?.isValid && hasValidReason
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={openModal}
        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
      >
        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m5 5v1a4 4 0 01-4 4H8m0 0l3-3m-3 3l3 3"></path>
        </svg>
        Process Refund
      </button>
    )
  }

  return (
    <>
      {/* Modal backdrop */}
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
        <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          {/* Modal header */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Process Refund</h3>
            <button
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          {/* Payment info */}
          <div className="mb-4 p-3 bg-gray-50 rounded-md">
            <div className="text-sm text-gray-600">
              <div>Invoice: {invoiceNumber}</div>
              <div>Payment Amount: {formatAmount(paymentAmount)}</div>
              <div>Available for Refund: <span className="font-medium text-green-600">{formatAmount(availableAmount)}</span></div>
            </div>
          </div>

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <div className="text-sm text-green-600">{success}</div>
              <div className="text-xs text-green-500 mt-1">
                The user will receive an email notification about this refund.
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="text-sm text-red-600">{error}</div>
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit}>
              {/* Refund Type Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Refund Type
                </label>
                <div className="flex space-x-4">
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      name="refundType"
                      value="proportional"
                      checked={refundType === 'proportional'}
                      onChange={(e) => setRefundType(e.target.value as RefundType)}
                      className="form-radio h-4 w-4 text-blue-600"
                      disabled={isProcessing}
                    />
                    <span className="ml-2 text-sm text-gray-700">Proportional Refund</span>
                  </label>
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      name="refundType"
                      value="discount_code"
                      checked={refundType === 'discount_code'}
                      onChange={(e) => setRefundType(e.target.value as RefundType)}
                      className="form-radio h-4 w-4 text-blue-600"
                      disabled={isProcessing}
                    />
                    <span className="ml-2 text-sm text-gray-700">Apply Discount Code</span>
                  </label>
                </div>
              </div>

              {refundType === 'proportional' ? (
                /* Proportional Refund Fields */
                <>
                  {/* Refund amount */}
              <div className="mb-4">
                <label htmlFor="refundAmount" className="block text-sm font-medium text-gray-700 mb-1">
                  Refund Amount ($)
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    id="refundAmount"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    step="0.01"
                    min="0.01"
                    max={(availableAmount / 100).toFixed(2)}
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                    required
                    disabled={isProcessing}
                  />
                  <button
                    type="button"
                    onClick={handleFullRefund}
                    className="px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
                    disabled={isProcessing}
                  >
                    Full
                  </button>
                </div>
                {refundAmount && !isValidAmount() && (
                  <div className="mt-1 text-xs text-red-600">
                    Amount must be between $0.01 and {formatAmount(availableAmount)}
                  </div>
                )}
              </div>
                </>
              ) : (
                /* Discount Code Refund Fields */
                <>
                  <div className="mb-4">
                    <label htmlFor="discountCode" className="block text-sm font-medium text-gray-700 mb-1">
                      Discount Code
                    </label>
                    <input
                      type="text"
                      id="discountCode"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value.toUpperCase().trim())}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter discount code (e.g., PRIDE100)"
                      disabled={isProcessing || isValidatingDiscount}
                    />
                    {isValidatingDiscount && (
                      <div className="mt-1 text-xs text-gray-500">
                        Validating discount code...
                      </div>
                    )}
                    {discountValidation?.isValid && (
                      <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-md">
                        <div className="text-sm text-green-800 font-medium">
                          {discountValidation.discountCode?.code} - {discountValidation.discountCode?.category.name}
                        </div>
                        <div className="text-sm text-green-600">
                          Refund Amount: {formatAmount(discountValidation.discountAmount || 0)}
                        </div>
                        {discountValidation.isPartialDiscount && (
                          <div className="text-xs text-orange-600 mt-1">
                            {discountValidation.partialDiscountMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Reason - common to both types */}
              <div className="mb-6">
                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Explain the reason for this refund..."
                  required
                  disabled={isProcessing}
                />
                {reason && !isValidReason() && (
                  <div className="mt-1 text-xs text-red-600">
                    Please provide a reason for the refund
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  disabled={isProcessing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isProcessing || !isFormValid()}
                >
                  {isProcessing ? 'Processing...' : 'Process Refund'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  )
}