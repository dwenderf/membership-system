'use client'

import { useState, useEffect } from 'react'

interface CategoryOption {
  id: string
  name: string
  price: number
  currentCount: number
  maxCapacity: number | null
}

interface ChangeCategoryModalProps {
  userRegistrationId: string
  userId: string
  registrationId: string
  currentCategoryId: string
  currentCategoryName: string
  currentAmountPaid: number
  userName: string
  registrationName: string
  onSuccess?: () => void
  onCancel?: () => void
}

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function ChangeCategoryModal({
  userRegistrationId,
  registrationId,
  currentCategoryId,
  currentCategoryName,
  currentAmountPaid,
  userName,
  registrationName,
  onSuccess,
  onCancel
}: ChangeCategoryModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    if (isOpen) {
      fetchCategories()
    }
  }, [isOpen, registrationId])

  const fetchCategories = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/admin/registration-categories/${registrationId}`)

      if (!response.ok) {
        throw new Error('Failed to fetch categories')
      }

      const data = await response.json()

      const availableCategories = data.categories.filter(
        (cat: CategoryOption) => cat.id !== currentCategoryId
      )

      setCategories(availableCategories)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories')
    } finally {
      setIsLoading(false)
    }
  }

  const getSelectedCategory = () => {
    return categories.find(cat => cat.id === selectedCategoryId)
  }

  const calculatePriceDifference = () => {
    const selected = getSelectedCategory()
    if (!selected) return 0
    return selected.price - currentAmountPaid
  }

  const getPriceDifferenceDisplay = () => {
    const diff = calculatePriceDifference()
    if (diff > 0) {
      return {
        action: 'charge',
        message: `User will be charged ${formatAmount(diff)}`,
        color: 'text-blue-700',
        icon: '+'
      }
    } else if (diff < 0) {
      return {
        action: 'refund',
        message: `User will be refunded ${formatAmount(Math.abs(diff))}`,
        color: 'text-green-700',
        icon: '-'
      }
    } else {
      return {
        action: 'none',
        message: 'No charge or refund (same price)',
        color: 'text-gray-700',
        icon: '='
      }
    }
  }

  const handleSubmit = async () => {
    if (!selectedCategoryId) {
      setError('Please select a category')
      return
    }

    if (!reason.trim()) {
      setError('Please provide a reason for the category change')
      return
    }

    const selected = getSelectedCategory()
    if (!selected) return

    if (selected.maxCapacity && selected.currentCount >= selected.maxCapacity) {
      setError(`Selected category is at full capacity (${selected.currentCount}/${selected.maxCapacity})`)
      return
    }

    setIsProcessing(true)
    setError('')

    try {
      const response = await fetch('/api/admin/registrations/change-category', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userRegistrationId,
          newCategoryId: selectedCategoryId,
          reason: reason.trim()
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to change category')
      }

      setSuccessMessage(data.message)
      setTimeout(() => {
        if (onSuccess) {
          onSuccess()
        } else {
          // Default behavior: refresh the page
          window.location.reload()
        }
      }, 1500)

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to change category'
      setError(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    if (onCancel) {
      onCancel()
    }
    setIsOpen(false)
  }

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
      >
        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        Change Category
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-[500px] shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Change Registration Category</h3>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600" disabled={isProcessing}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <div className="text-sm text-gray-600">
            <div className="font-medium text-gray-900">{userName}</div>
            <div className="mt-1">{registrationName}</div>
            <div className="mt-2">
              <span className="font-semibold">Current Category:</span> {currentCategoryName}
            </div>
            <div>
              <span className="font-semibold">Current Amount Paid:</span> {formatAmount(currentAmountPaid)}
            </div>
          </div>
        </div>

        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <div className="text-sm text-green-600">{successMessage}</div>
          </div>
        )}

        {error && !successMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="text-sm text-red-600">{error}</div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading categories...</p>
          </div>
        ) : !successMessage && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Category <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-2">
                {categories.length === 0 ? (
                  <div className="text-sm text-gray-500 text-center py-4">
                    No other categories available for this registration
                  </div>
                ) : (
                  categories.map((category) => {
                    const isAtCapacity = category.maxCapacity && category.currentCount >= category.maxCapacity

                    return (
                      <label
                        key={category.id}
                        className={`flex items-center justify-between p-3 rounded-md border ${
                          selectedCategoryId === category.id
                            ? 'border-indigo-600 bg-indigo-50'
                            : isAtCapacity
                            ? 'border-gray-200 bg-gray-50 opacity-50'
                            : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center flex-1">
                          <input
                            type="radio"
                            name="category"
                            value={category.id}
                            checked={selectedCategoryId === category.id}
                            onChange={(e) => setSelectedCategoryId(e.target.value)}
                            disabled={isAtCapacity || isProcessing}
                            className="form-radio h-4 w-4 text-indigo-600"
                          />
                          <div className="ml-3 flex-1">
                            <div className="text-sm font-medium text-gray-900">
                              {category.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatAmount(category.price)}
                              {category.maxCapacity && (
                                <span className="ml-2">
                                  ({category.currentCount}/{category.maxCapacity} spots filled)
                                </span>
                              )}
                              {isAtCapacity && (
                                <span className="ml-2 text-red-600 font-semibold">FULL</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            {selectedCategoryId && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className={`text-sm font-medium ${getPriceDifferenceDisplay().color}`}>
                  {getPriceDifferenceDisplay().icon} {getPriceDifferenceDisplay().message}
                </div>
              </div>
            )}

            <div className="mb-6">
              <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Change <span className="text-red-500">*</span>
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Explain why this category change is being made..."
                disabled={isProcessing}
              />
            </div>

            {selectedCategoryId && calculatePriceDifference() > 0 && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-xs text-yellow-800">
                    User must have a valid payment method on file. The charge will be processed immediately.
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isProcessing || !selectedCategoryId || !reason.trim()}
              >
                {isProcessing ? 'Processing...' : 'Change Category'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
      )}
    </>
  )
}
