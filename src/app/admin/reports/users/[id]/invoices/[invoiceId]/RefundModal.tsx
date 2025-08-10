'use client'

import { useState } from 'react'
import { formatAmount } from '@/lib/invoice-utils'

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
  const [refundAmount, setRefundAmount] = useState('')
  const [reason, setReason] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const openModal = () => {
    setIsOpen(true)
    setRefundAmount('')
    setReason('')
    setError('')
    setSuccess('')
  }

  const closeModal = () => {
    setIsOpen(false)
    setRefundAmount('')
    setReason('')
    setError('')
    setSuccess('')
  }

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
          reason: reason.trim() || undefined
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
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="text-sm text-red-600">{error}</div>
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit}>
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
              </div>

              {/* Reason */}
              <div className="mb-6">
                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
                  Reason (optional)
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Explain the reason for this refund..."
                  disabled={isProcessing}
                />
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
                  disabled={isProcessing}
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