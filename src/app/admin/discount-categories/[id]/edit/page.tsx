'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function EditDiscountCategoryPage() {
  const router = useRouter()
  const params = useParams()
  const categoryId = params.id as string
  const supabase = createClient()
  
  const [category, setCategory] = useState<any>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    accounting_code: '',
    max_discount_per_user_per_season: '',
    is_active: true,
  })
  const [limitDisplay, setLimitDisplay] = useState('')
  
  const [existingCategories, setExistingCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch category data and existing categories for duplicate checking
  useEffect(() => {
    const fetchData = async () => {
      // Get current category data
      const { data: categoryData, error: categoryError } = await supabase
        .from('discount_categories')
        .select('*')
        .eq('id', categoryId)
        .single()

      if (categoryError) {
        setError('Category not found')
        return
      }

      if (categoryData) {
        setCategory(categoryData)
        setFormData({
          name: categoryData.name || '',
          description: categoryData.description || '',
          accounting_code: categoryData.accounting_code || '',
          max_discount_per_user_per_season: categoryData.max_discount_per_user_per_season ? categoryData.max_discount_per_user_per_season.toString() : '',
          is_active: categoryData.is_active ?? true,
        })
        
        // Set limit display
        if (categoryData.max_discount_per_user_per_season) {
          setLimitDisplay((categoryData.max_discount_per_user_per_season / 100).toFixed(2))
        }
      }

      // Get existing categories for duplicate checking (excluding current category)
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('discount_categories')
        .select('id, name, accounting_code')
        .neq('id', categoryId)
      
      if (!categoriesError && categoriesData) {
        setExistingCategories(categoriesData)
      }
    }
    
    fetchData()
  }, [categoryId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canUpdateCategory) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      const categoryData = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        accounting_code: formData.accounting_code.trim().toUpperCase(),
        max_discount_per_user_per_season: formData.max_discount_per_user_per_season ? parseInt(formData.max_discount_per_user_per_season) : null,
        is_active: formData.is_active,
      }

      const response = await fetch(`/api/admin/discount-categories/${categoryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(categoryData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to update discount category')
      } else {
        router.push('/admin/discount-categories')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Check for duplicate name or accounting code
  const nameExists = existingCategories.some(cat => 
    cat.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  const accountingCodeExists = existingCategories.some(cat => 
    cat.accounting_code.toLowerCase() === formData.accounting_code.trim().toLowerCase()
  )
  
  const canUpdateCategory = formData.name.trim() && 
                           formData.accounting_code.trim() &&
                           (!formData.max_discount_per_user_per_season || parseInt(formData.max_discount_per_user_per_season) > 0) &&
                           !nameExists &&
                           !accountingCodeExists

  if (!category) {
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
            <h1 className="text-3xl font-bold text-gray-900">Edit Discount Category</h1>
            <p className="mt-1 text-sm text-gray-600">
              Update organizational discount category settings
            </p>
          </div>

          {/* Quick Actions */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-blue-800">Manage Discount Codes</h3>
                <p className="mt-1 text-sm text-blue-700">
                  View and manage all discount codes for this category
                </p>
              </div>
              <Link
                href={`/admin/discount-codes?category=${categoryId}`}
                className="inline-flex items-center px-3 py-2 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50"
              >
                Manage Codes
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

              {/* Category Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Category Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., Scholarship Fund, Board Member, Captain"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  Organizational category for grouping discount codes
                </p>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  Description (Optional)
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., Financial assistance for players in need"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Optional description of this discount category
                </p>
              </div>

              {/* Accounting Code */}
              <div>
                <label htmlFor="accounting_code" className="block text-sm font-medium text-gray-700">
                  Accounting Code
                </label>
                <input
                  type="text"
                  id="accounting_code"
                  value={formData.accounting_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, accounting_code: e.target.value.toUpperCase() }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., DISCOUNT-SCHOLAR, DISCOUNT-BOARD"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  Unique code for Xero accounting integration (will be converted to uppercase)
                </p>
              </div>

              {/* Spending Limit */}
              <div>
                <label htmlFor="max_discount" className="block text-sm font-medium text-gray-700">
                  Maximum Discount Per User Per Season (Optional)
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                    type="number"
                    id="max_discount"
                    min="1"
                    step="0.01"
                    value={limitDisplay}
                    onChange={(e) => setLimitDisplay(e.target.value)}
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value === '') {
                        setFormData(prev => ({ ...prev, max_discount_per_user_per_season: '' }))
                        setLimitDisplay('')
                        return
                      }
                      
                      const dollars = parseFloat(value)
                      if (!isNaN(dollars) && dollars >= 1) {
                        const cents = Math.round(dollars * 100)
                        setFormData(prev => ({ ...prev, max_discount_per_user_per_season: cents.toString() }))
                        setLimitDisplay(dollars.toFixed(2))
                      } else {
                        // Invalid input, reset to previous valid value
                        if (formData.max_discount_per_user_per_season) {
                          setLimitDisplay((parseInt(formData.max_discount_per_user_per_season) / 100).toFixed(2))
                        } else {
                          setLimitDisplay('')
                        }
                      }
                    }}
                    className="pl-7 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="e.g., 500.00"
                  />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Maximum total discount amount per user per season (leave empty for no limit)
                </p>
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
                  Category is active (codes can be created and used)
                </label>
              </div>

              {/* Duplicate Warnings */}
              {nameExists && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                      <p className="text-sm text-yellow-700">A category with the name "{formData.name}" already exists</p>
                    </div>
                  </div>
                </div>
              )}

              {accountingCodeExists && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                      <p className="text-sm text-yellow-700">A category with the accounting code "{formData.accounting_code}" already exists</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Category Preview */}
              {formData.name && formData.accounting_code && (
                <div className={`border rounded-md p-4 ${(nameExists || accountingCodeExists) ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Category Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Name</dt>
                      <dd className="text-sm text-gray-900">{formData.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Accounting Code</dt>
                      <dd className="text-sm text-gray-900">{formData.accounting_code}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Spending Limit</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.max_discount_per_user_per_season 
                          ? `$${(parseInt(formData.max_discount_per_user_per_season) / 100).toFixed(2)} per user per season`
                          : 'No limit'
                        }
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Status</dt>
                      <dd className="text-sm text-gray-900">{formData.is_active ? 'Active' : 'Inactive'}</dd>
                    </div>
                    {formData.description && (
                      <div className="sm:col-span-2">
                        <dt className="text-sm font-medium text-gray-500">Description</dt>
                        <dd className="text-sm text-gray-900">{formData.description}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <Link
                  href="/admin/discount-categories"
                  className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={loading || !canUpdateCategory}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canUpdateCategory && !loading
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
                  {loading ? 'Updating Category...' : canUpdateCategory ? 'Update Category' : 'Complete Form to Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}