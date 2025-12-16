'use client'

import { useState, useEffect, useRef } from 'react'
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
  const [stagingData, setStagingData] = useState<any>(null)
  const [isStaging, setIsStaging] = useState(false)
  const [isRegistrationPayment, setIsRegistrationPayment] = useState<boolean | null>(null)
  const discountCodeInputRef = useRef<HTMLInputElement>(null)

  const checkIfRegistrationPayment = async () => {
    try {
      const response = await fetch(`/api/admin/payments/${paymentId}/registrations`)
      if (response.ok) {
        const data = await response.json()
        setIsRegistrationPayment(data.registrations && data.registrations.length > 0)
      } else {
        setIsRegistrationPayment(false)
      }
    } catch (error) {
      console.error('Error checking payment type:', error)
      setIsRegistrationPayment(false)
    }
  }

  // Reset to proportional if user was on discount_code but payment is not a registration
  useEffect(() => {
    if (isRegistrationPayment === false && refundType === 'discount_code') {
      setRefundType('proportional')
    }
  }, [isRegistrationPayment, refundType])

  const openModal = () => {
    setIsOpen(true)
    setRefundType('proportional')
    setRefundAmount('')
    setDiscountCode('')
    setDiscountValidation(null)
    setReason('')
    setError('')
    setSuccess('')
    checkIfRegistrationPayment() // Check payment type when modal opens
  }

  const closeModal = async () => {
    // If there's staging data, mark it as ignored
    if (stagingData?.staging_id) {
      try {
        await fetch('/api/admin/refunds/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            refundId: stagingData.refund_id, // Will be null during preview
            stagingId: stagingData.staging_id
          })
        })
      } catch (error) {
        console.error('Failed to cancel staged refund:', error)
      }
    }
    
    // Reset all state
    setIsOpen(false)
    setRefundType('proportional')
    setRefundAmount('')
    setDiscountCode('')
    setDiscountValidation(null)
    setReason('')
    setError('')
    setSuccess('')
    setStagingData(null)
    setIsStaging(false)
  }

  const validateDiscountCode = async (code: string) => {
    if (!code.trim()) {
      setDiscountValidation(null)
      return
    }

    // Store current cursor position before validation
    const currentPosition = discountCodeInputRef.current?.selectionStart || 0

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
          amount: paymentAmount, // Original payment amount
          isRefund: true // Flag to indicate this is a refund validation
        })
      })

      const result = await response.json()
      setDiscountValidation(result)
      
      // Don't set main error for validation - let inline validation handle it
    } catch (err) {
      setDiscountValidation({
        isValid: false,
        error: 'Failed to validate discount code'
      })
      // Don't set main error for validation - let inline validation handle it
    } finally {
      setIsValidatingDiscount(false)
      // Restore focus and cursor position after validation
      setTimeout(() => {
        if (discountCodeInputRef.current) {
          discountCodeInputRef.current.focus()
          // Restore cursor position
          discountCodeInputRef.current.setSelectionRange(currentPosition, currentPosition)
        }
      }, 50) // Slightly longer timeout to ensure DOM has settled
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

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsStaging(true)

    try {
      let requestData: any = {
        paymentId,
        refundType
      }

      if (refundType === 'proportional') {
        const amount = parseFloat(refundAmount)

        // Allow zero-dollar refunds for registration payments (to cancel free registrations)
        const minAllowed = isRegistrationPayment === true ? 0 : 0.01
        if (isNaN(amount) || amount < minAllowed) {
          setError('Please enter a valid refund amount')
          return
        }

        const amountInCents = Math.round(amount * 100)
        if (amountInCents > availableAmount) {
          setError(`Refund amount cannot exceed ${formatAmount(availableAmount)}`)
          return
        }

        requestData.amount = amount
      } else if (refundType === 'discount_code') {
        if (!discountValidation?.isValid) {
          setError('Please validate the discount code first')
          return
        }
        requestData.discountValidation = discountValidation
      }

      // Create staging records
      const response = await fetch('/api/admin/refunds/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to stage refund')
      }

      setStagingData(data.staging)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create refund staging')
    } finally {
      setIsStaging(false)
    }
  }

  const handleConfirm = async () => {
    if (!stagingData?.staging_id) {
      setError('No staging data available')
      return
    }

    setIsProcessing(true)
    setError('')

    try {
      const response = await fetch('/api/admin/refunds/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stagingId: stagingData.staging_id,
          paymentId: stagingData.payment_info.payment_id,
          refundAmount: stagingData.total_amount,
          reason: reason.trim()
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process refund')
      }

      setSuccess(data.message)
      
      // Refresh the page after successful refund
      setTimeout(() => {
        window.location.reload()
      }, 2000)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process refund')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancel = async () => {
    if (stagingData?.staging_id) {
      try {
        await fetch('/api/admin/refunds/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            refundId: stagingData.refund_id, // Will be null during preview
            stagingId: stagingData.staging_id
          })
        })
      } catch (error) {
        console.error('Failed to cancel staged refund:', error)
      }
    }
    
    // Reset to form state
    setStagingData(null)
    setError('')
    setSuccess('')
  }

  const handleFullRefund = () => {
    setRefundAmount((availableAmount / 100).toFixed(2))
  }

  // Validate refund amount in real-time
  const isValidAmount = () => {
    const amountInCents = Math.round(parseFloat(refundAmount) * 100)
    // Allow zero-dollar refunds for registration payments (to cancel free registrations)
    const minAmount = isRegistrationPayment === true ? 0 : 1
    return !isNaN(amountInCents) && amountInCents >= minAmount && amountInCents <= availableAmount
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

          {!success && !stagingData && (
            <form onSubmit={handlePreview}>
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
                  {/* Only show discount code option for registration payments */}
                  {isRegistrationPayment && (
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
                  )}
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
                    min={isRegistrationPayment === true ? "0.00" : "0.01"}
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
                    Amount must be between {isRegistrationPayment === true ? '$0.00' : '$0.01'} and {formatAmount(availableAmount)}
                  </div>
                )}
              </div>

              {/* Warning for proportional refunds on registration payments */}
              {isRegistrationPayment && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div className="text-xs text-yellow-800">
                      <div className="font-semibold">Registration Status Update</div>
                      <div className="mt-1">This proportional refund will automatically mark the user&apos;s registration(s) as &quot;refunded&quot;, removing them from the active roster and freeing up their spot for others.</div>
                    </div>
                  </div>
                </div>
              )}
                </>
              ) : (
                /* Discount Code Refund Fields */
                <>
                  <div className="mb-4">
                    <label htmlFor="discountCode" className="block text-sm font-medium text-gray-700 mb-1">
                      Discount Code
                    </label>
                    <input
                      ref={discountCodeInputRef}
                      type="text"
                      id="discountCode"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value.toUpperCase().trim())}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter discount code (e.g., PRIDE100)"
                      disabled={isProcessing}
                    />
                    
                    {/* Validation States - Fixed layout */}
                    {isValidatingDiscount && (
                      <div className="mt-2 text-sm text-blue-700 flex items-center">
                        <svg className="animate-spin w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Validating discount code...
                      </div>
                    )}
                    
                    {discountValidation?.isValid && (
                      <div className={`mt-2 text-sm flex items-start ${discountValidation.isPartialDiscount ? 'text-yellow-700' : 'text-green-700'}`}>
                        <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          {discountValidation.isPartialDiscount ? (
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          )}
                        </svg>
                        <div>
                          <div className="font-medium">
                            {discountValidation.isPartialDiscount ? (
                              discountValidation.partialDiscountMessage
                            ) : (
                              <>
                                {discountValidation.discountCode?.percentage}% discount applied. Total refund is ${((discountValidation.discountAmount || 0) / 100).toFixed(2)}
                              </>
                            )}
                          </div>
                          {!discountValidation.isPartialDiscount && (
                            <div className="text-xs">
                              {discountValidation.discountCode?.category.name}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {discountValidation?.isValid === false && discountCode && (
                      <div className="mt-2 text-sm text-red-700 flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        {discountValidation.error}
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
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isStaging || !isFormValid()}
                >
                  {isStaging ? 'Creating Preview...' : 'Preview Refund'}
                </button>
              </div>
            </form>
          )}

          {/* Staging Preview */}
          {!success && stagingData && (
            <div>
              <div className="mb-4">
                <h4 className="text-lg font-medium text-gray-900 mb-2">Refund Preview</h4>
                <p className="text-sm text-gray-600">
                  Review the line items that will be created in Xero before confirming the refund.
                </p>
              </div>

              {/* Refund Summary */}
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm">
                  <div className="font-medium text-blue-900">
                    {stagingData.refund_type === 'proportional' ? 'Proportional Refund' : 'Discount Code Refund'}: {formatAmount(stagingData.total_amount)}
                  </div>
                  {stagingData.discount_info && (
                    <div className="text-blue-700 mt-1">
                      {stagingData.discount_info.code} - {stagingData.discount_info.category}
                      {stagingData.discount_info.is_partial && (
                        <div className="text-xs text-orange-600 mt-1">
                          {stagingData.discount_info.partial_message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Line Items Preview */}
              <div className="mb-6">
                <h5 className="text-sm font-medium text-gray-900 mb-3">Credit Note Line Items</h5>
                <div className="border rounded-md">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account Code</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {stagingData.line_items?.map((item: any, index: number) => (
                        <tr key={index}>
                          <td className="px-4 py-2 text-sm text-gray-900">{item.description}</td>
                          <td className="px-4 py-2 text-sm text-gray-500">{item.account_code}</td>
                          <td className="px-4 py-2 text-sm text-gray-900 text-right">
                            {formatAmount(item.line_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Confirmation Reason */}
              <div className="mb-6">
                <label htmlFor="confirmReason" className="block text-sm font-medium text-gray-700 mb-1">
                  Final Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="confirmReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Confirm the reason for this refund..."
                  required
                  disabled={isProcessing}
                />
              </div>

              {/* Confirmation Actions */}
              <div className="flex justify-between space-x-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  disabled={isProcessing}
                >
                  ← Back to Edit
                </button>
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    disabled={isProcessing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isProcessing || !reason.trim()}
                  >
                    {isProcessing ? 'Processing Refund...' : 'Confirm & Process Refund'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}