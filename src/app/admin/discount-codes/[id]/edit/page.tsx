'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function EditDiscountCodePage() {
  const router = useRouter()
  const params = useParams()
  const codeId = params.id as string
  const supabase = createClient()
  
  const [code, setCode] = useState<any>(null)
  const [formData, setFormData] = useState({
    code: '',
    percentage: '',
    valid_from: '',
    valid_until: '',
    is_active: true,
  })
  
  const [existingCodes, setExistingCodes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch code data and existing codes for duplicate checking
  useEffect(() => {
    const fetchData = async () => {
      // Get current code data with category info
      const { data: codeData, error: codeError } = await supabase
        .from('discount_codes')
        .select(`
          *,
          discount_categories (
            id,
            name,
            accounting_code,
            max_discount_per_user_per_season
          )
        `)
        .eq('id', codeId)
        .single()

      if (codeError) {
        setError('Discount code not found')
        return
      }

      if (codeData) {
        setCode(codeData)
        setFormData({
          code: codeData.code || '',
          percentage: codeData.percentage ? codeData.percentage.toString() : '',
          valid_from: codeData.valid_from ? codeData.valid_from.split('T')[0] : '',
          valid_until: codeData.valid_until ? codeData.valid_until.split('T')[0] : '',
          is_active: codeData.is_active ?? true,
        })
      }

      // Get existing codes for duplicate checking (excluding current code)
      const { data: codesData, error: codesError } = await supabase
        .from('discount_codes')
        .select('id, code')
        .neq('id', codeId)
      
      if (!codesError && codesData) {
        setExistingCodes(codesData)
      }
    }
    
    fetchData()
  }, [codeId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canUpdateCode) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      const percentage = parseFloat(formData.percentage)
      
      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
        setError('Please enter a valid percentage between 1 and 100')
        setLoading(false)
        return
      }

      // Validate dates
      if (formData.valid_from && formData.valid_until) {
        const fromDate = new Date(formData.valid_from)
        const untilDate = new Date(formData.valid_until)
        if (fromDate >= untilDate) {
          setError('Valid from date must be before valid until date')
          setLoading(false)
          return
        }
      }

      const codeData = {
        code: formData.code.trim().toUpperCase(),
        percentage: percentage,
        valid_from: formData.valid_from || null,
        valid_until: formData.valid_until || null,
        is_active: formData.is_active,
      }

      const response = await fetch(`/api/admin/discount-codes/${codeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(codeData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to update discount code')
      } else {
        // Navigate back to codes list, filtered by category if we came from there
        const returnUrl = code?.discount_categories?.id 
          ? `/admin/discount-codes?category=${code.discount_categories.id}`
          : '/admin/discount-codes'
        router.push(returnUrl)
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Check for duplicate code
  const codeExists = existingCodes.some(existingCode => 
    existingCode.code.toLowerCase() === formData.code.trim().toLowerCase()
  )
  
  const canUpdateCode = formData.code.trim() &&
                       formData.percentage &&
                       parseFloat(formData.percentage) > 0 &&
                       parseFloat(formData.percentage) <= 100 &&
                       !codeExists

  if (!code) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-gray-600">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Edit Discount Code</h1>
            <p className="mt-1 text-sm text-gray-600">
              Update discount code for {code.discount_categories?.name}
            </p>
          </div>

          {/* Category Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-blue-800">Category: {code.discount_categories?.name}</h3>
                <p className="mt-1 text-sm text-blue-700">
                  Accounting Code: {code.discount_categories?.accounting_code}
                  {code.discount_categories?.max_discount_per_user_per_season && (
                    <span> • Limit: ${(code.discount_categories.max_discount_per_user_per_season / 100).toFixed(2)}/season</span>
                  )}
                </p>
              </div>
              <Link
                href={`/admin/discount-codes?category=${code.discount_categories?.id}`}
                className="inline-flex items-center px-3 py-2 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50"
              >
                Back to Category Codes
              </Link>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white shadow rounded-lg">
            <form onSubmit={handleSubmit} className="space-y-6 p-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
                  {error}
                </div>
              )}

              {/* Discount Code */}
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                  Discount Code
                </label>
                <input
                  type="text"
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value.toUpperCase().trim() }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., PRIDE100, SCHOLAR50"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  Unique code that users will enter (will be converted to uppercase)
                </p>
              </div>

              {/* Percentage */}
              <div>
                <label htmlFor="percentage" className="block text-sm font-medium text-gray-700">
                  Discount Percentage
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    type="number"
                    id="percentage"
                    step="0.01"
                    min="0.01"
                    max="100"
                    value={formData.percentage}
                    onChange={(e) => setFormData(prev => ({ ...prev, percentage: e.target.value }))}
                    className="block w-full pr-12 border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="0.00"
                    required
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">%</span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Percentage discount to apply (1-100%)
                </p>
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="valid_from" className="block text-sm font-medium text-gray-700">
                    Valid From (Optional)
                  </label>
                  <input
                    type="date"
                    id="valid_from"
                    value={formData.valid_from}
                    onChange={(e) => setFormData(prev => ({ ...prev, valid_from: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    When this code becomes valid
                  </p>
                </div>

                <div>
                  <label htmlFor="valid_until" className="block text-sm font-medium text-gray-700">
                    Valid Until (Optional)
                  </label>
                  <input
                    type="date"
                    id="valid_until"
                    value={formData.valid_until}
                    onChange={(e) => setFormData(prev => ({ ...prev, valid_until: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    When this code expires
                  </p>
                </div>
              </div>

              {/* Is Active */}
              <div className="flex items-center">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                  Code is active (can be used by customers)
                </label>
              </div>

              {/* Duplicate Code Warning */}
              {codeExists && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                      <p className="text-sm text-yellow-700">A discount code "{formData.code.toUpperCase()}" already exists</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Code Preview */}
              {formData.code && (
                <div className={`border rounded-md p-4 ${codeExists ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Discount Code Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Code</dt>
                      <dd className="text-sm text-gray-900 font-mono">{formData.code.toUpperCase()}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Discount</dt>
                      <dd className="text-sm text-gray-900">{formData.percentage}% off</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Category</dt>
                      <dd className="text-sm text-gray-900">{code.discount_categories?.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Status</dt>
                      <dd className="text-sm text-gray-900">{formData.is_active ? 'Active' : 'Inactive'}</dd>
                    </div>
                    {(formData.valid_from || formData.valid_until) && (
                      <div className="sm:col-span-2">
                        <dt className="text-sm font-medium text-gray-500">Valid Period</dt>
                        <dd className="text-sm text-gray-900">
                          {formData.valid_from && `From ${new Date(formData.valid_from).toLocaleDateString()}`}
                          {formData.valid_from && formData.valid_until && ' '}
                          {formData.valid_until && `Until ${new Date(formData.valid_until).toLocaleDateString()}`}
                          {!formData.valid_from && !formData.valid_until && 'No expiration'}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <Link
                  href={code?.discount_categories?.id 
                    ? `/admin/discount-codes?category=${code.discount_categories.id}`
                    : '/admin/discount-codes'
                  }
                  className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={loading || !canUpdateCode}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canUpdateCode && !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {loading && (
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {loading ? 'Updating Code...' : canUpdateCode ? 'Update Discount Code' : 'Complete Form to Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}