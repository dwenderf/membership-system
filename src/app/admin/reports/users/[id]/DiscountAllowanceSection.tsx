'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import { formatAmount } from '@/lib/format-utils'
import { formatDate } from '@/lib/date-utils'

interface Allowance {
  id: string
  userId: string
  seasonId: string
  seasonName: string
  categoryId: string
  categoryName: string
  discountPercentage: number
  maxDiscountAmount: number | null
  notes: string | null
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
  totalUsed: number
  remaining: number | null
  effectiveMaxAllowed: number | null
  isEligible: boolean
  isRevoked: boolean
}

interface AvailableOption {
  seasonId: string
  seasonName: string
  categoryId: string
  categoryName: string
}

interface DiscountAllowanceSectionProps {
  userId: string
  userName: string
}

export default function DiscountAllowanceSection({
  userId,
  userName
}: DiscountAllowanceSectionProps) {
  const [allowances, setAllowances] = useState<Allowance[]>([])
  const [availableOptions, setAvailableOptions] = useState<AvailableOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAllowance, setEditingAllowance] = useState<Allowance | null>(null)

  // Form State
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number>(0)
  const [percentageInput, setPercentageInput] = useState<string>('')
  const [isUncapped, setIsUncapped] = useState<boolean>(false)
  const [dollarsInput, setDollarsInput] = useState<string>('')
  const [notesInput, setNotesInput] = useState<string>('')

  const { showSuccess, showError } = useToast()
  const router = useRouter()

  useEffect(() => {
    fetchAllowances()
  }, [userId])

  const fetchAllowances = async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/discount-allowances`)
      const data = await res.json()

      if (res.ok) {
        setAllowances(data.allowances || [])
        setAvailableOptions(data.availableOptions || [])
        setLoadError(false)
      } else {
        console.error('Error fetching discount allowances:', data.error)
        setLoadError(true)
        showError(data.error || 'Failed to load discount allowances')
      }
    } catch (err) {
      console.error('Error fetching discount allowances:', err)
      setLoadError(true)
      showError('Failed to load discount allowances')
    } finally {
      setLoading(false)
    }
  }

  const openAddModal = () => {
    setEditingAllowance(null)
    setSelectedOptionIndex(0)
    setPercentageInput('50')
    setIsUncapped(false)
    setDollarsInput('250.00')
    setNotesInput('')
    setIsModalOpen(true)
  }

  const openEditModal = (allowance: Allowance) => {
    setEditingAllowance(allowance)
    setPercentageInput(String(allowance.discountPercentage))
    if (allowance.maxDiscountAmount === null) {
      setIsUncapped(true)
      setDollarsInput('')
    } else {
      setIsUncapped(false)
      setDollarsInput((allowance.maxDiscountAmount / 100).toFixed(2))
    }
    setNotesInput(allowance.notes || '')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingAllowance(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const pct = parseFloat(percentageInput)
    if (isNaN(pct) || pct < 1 || pct > 100) {
      showError('Percentage must be between 1 and 100')
      return
    }

    let cents: number | null = null
    if (!isUncapped) {
      const dollars = parseFloat(dollarsInput)
      if (isNaN(dollars) || dollars < 0) {
        showError('Dollar limit must be a valid non-negative number')
        return
      }
      cents = Math.round(dollars * 100)
    }

    let seasonId = ''
    let categoryId = ''

    if (editingAllowance) {
      seasonId = editingAllowance.seasonId
      categoryId = editingAllowance.categoryId
    } else {
      if (availableOptions.length === 0) {
        showError('No available season/category combinations to add')
        return
      }
      const option = availableOptions[selectedOptionIndex]
      seasonId = option.seasonId
      categoryId = option.categoryId
    }

    setIsSubmitting(true)

    try {
      const res = await fetch(`/api/admin/users/${userId}/discount-allowances`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId,
          categoryId,
          discountPercentage: pct,
          maxDiscountAmount: cents,
          notes: notesInput.trim() || null
        })
      })

      const data = await res.json()

      if (res.ok && data.success) {
        showSuccess(
          editingAllowance
            ? `Updated allowance for ${userName}`
            : `Added allowance for ${userName}`
        )
        closeModal()
        fetchAllowances()
        router.refresh()
      } else {
        showError(data.error || 'Failed to save discount allowance')
      }
    } catch (err) {
      showError('An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevoke = async (allowance: Allowance) => {
    if (!confirm(`Are you sure you want to revoke the ${allowance.categoryName} allowance for ${allowance.seasonName}?`)) {
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/discount-allowances`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId: allowance.seasonId,
          categoryId: allowance.categoryId,
          discountPercentage: allowance.discountPercentage,
          maxDiscountAmount: 0, // Revocation sets max_discount_amount = 0
          notes: allowance.notes
        })
      })

      const data = await res.json()

      if (res.ok && data.success) {
        showSuccess(`Revoked ${allowance.categoryName} allowance for ${userName}`)
        fetchAllowances()
        router.refresh()
      } else {
        showError(data.error || 'Failed to revoke allowance')
      }
    } catch (err) {
      showError('An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Per-User Discount Allowances</h2>
        <p className="mt-1 text-sm text-gray-600">
          Grant, edit, and revoke custom seasonal discount percentages and caps
        </p>
        {availableOptions.length > 0 && (
          <button
            onClick={openAddModal}
            className="mt-3 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          >
            + Add Allowance
          </button>
        )}
      </div>

      <div className="px-6 py-4">
        {/* Help text callout box */}
        <div className="mb-4 bg-blue-50 border-l-4 border-blue-400 p-3 rounded text-xs text-blue-800 space-y-1">
          <p className="font-medium">📌 Important Operational Guidance:</p>
          <p>1. Allowance rows take effect immediately upon saving.</p>
          <p>2. Members redeeming legacy fixed-percentage codes (e.g. PRIDE75) are capped by their allowance dollar limit.</p>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 py-4">Loading discount allowances...</div>
        ) : loadError ? (
          <div className="text-sm text-red-600 py-4 text-center border-2 border-dashed border-red-200 rounded-lg space-y-2">
            <p>Failed to load discount allowances.</p>
            <button
              onClick={() => {
                setLoading(true)
                fetchAllowances()
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        ) : allowances.length === 0 ? (
          <div className="text-sm text-gray-500 py-4 text-center border-2 border-dashed border-gray-200 rounded-lg">
            No active or upcoming discount allowances for this user.
          </div>
        ) : (
          <div className="space-y-4">
            {allowances.map((allowance) => (
              <div
                key={allowance.id}
                className={`border rounded-lg p-4 transition-colors ${
                  allowance.isRevoked ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="mb-2">
                  <h4 className="text-sm font-semibold text-gray-900">{allowance.categoryName}</h4>
                  <span className="text-xs text-gray-500">{allowance.seasonName}</span>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {allowance.isRevoked ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Revoked
                      </span>
                    ) : allowance.maxDiscountAmount === null ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        No dollar cap
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    )}

                    <button
                      onClick={() => openEditModal(allowance)}
                      disabled={isSubmitting}
                      className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs font-medium"
                    >
                      Edit
                    </button>
                    {!allowance.isRevoked && (
                      <button
                        onClick={() => handleRevoke(allowance)}
                        disabled={isSubmitting}
                        className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs mt-3 bg-white p-3 rounded border border-gray-100">
                  <div>
                    <span className="text-gray-500 block">Percentage</span>
                    <span className="font-medium text-gray-900">{allowance.discountPercentage}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Dollar Limit</span>
                    <span className="font-medium text-gray-900">
                      {allowance.maxDiscountAmount === null
                        ? 'No dollar cap'
                        : allowance.isRevoked
                        ? 'Revoked ($0.00)'
                        : formatAmount(allowance.maxDiscountAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Total Used</span>
                    <span className="font-medium text-blue-600">{formatAmount(allowance.totalUsed)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Remaining</span>
                    <span
                      className={`font-medium ${
                        allowance.isRevoked
                          ? 'text-red-600'
                          : allowance.remaining === null
                          ? 'text-purple-600'
                          : 'text-green-600'
                      }`}
                    >
                      {allowance.isRevoked
                        ? 'Not eligible'
                        : allowance.remaining === null
                        ? 'Unlimited'
                        : formatAmount(allowance.remaining)}
                    </span>
                  </div>
                </div>

                {allowance.notes && (
                  <div className="mt-2 text-xs text-gray-600 bg-gray-100 p-2 rounded">
                    <span className="font-medium text-gray-700">Notes: </span>
                    {allowance.notes}
                  </div>
                )}

                <div className="mt-2 text-[11px] text-gray-400">
                  Last updated {formatDate(new Date(allowance.updatedAt))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {editingAllowance ? 'Edit Discount Allowance' : 'Add Discount Allowance'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              {editingAllowance ? (
                <div className="bg-gray-50 p-3 rounded border text-xs">
                  <p><span className="font-medium">Category:</span> {editingAllowance.categoryName}</p>
                  <p><span className="font-medium">Season:</span> {editingAllowance.seasonName}</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Season & Category
                  </label>
                  <select
                    value={selectedOptionIndex}
                    onChange={(e) => setSelectedOptionIndex(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {availableOptions.map((opt, idx) => (
                      <option key={`${opt.seasonId}:${opt.categoryId}`} value={idx}>
                        {opt.seasonName} — {opt.categoryName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Discount Percentage (1–100%) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={percentageInput}
                  onChange={(e) => setPercentageInput(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-700">
                    Max Seasonal Discount ($)
                  </label>
                  <label className="flex items-center space-x-1 text-xs text-purple-700 font-medium">
                    <input
                      type="checkbox"
                      checked={isUncapped}
                      onChange={(e) => setIsUncapped(e.target.checked)}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span>No dollar cap</span>
                  </label>
                </div>

                {!isUncapped && (
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required={!isUncapped}
                    value={dollarsInput}
                    onChange={(e) => setDollarsInput(e.target.value)}
                    placeholder="e.g. 250.00"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes (survives revocation)
                </label>
                <textarea
                  rows={3}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Reason for aid / approval details..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Allowance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
