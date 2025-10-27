'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import AccountingCodeInput from '@/components/admin/AccountingCodeInput'

export default function NewDiscountCategoryPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    accounting_code: '',
    max_discount_per_user_per_season: '', // in dollars, will convert to cents
    is_active: true,
  })
  
  const [existingCategories, setExistingCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch existing categories to check for duplicates
  useEffect(() => {
    const fetchData = async () => {
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('discount_categories')
        .select('name, accounting_code')
      
      if (!categoriesError && categoriesData) {
        setExistingCategories(categoriesData)
      }
    }
    
    fetchData()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canCreateCategory) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      // Convert max discount from dollars to cents if provided
      let maxDiscountInCents = null
      if (formData.max_discount_per_user_per_season) {
        maxDiscountInCents = Math.round(parseFloat(formData.max_discount_per_user_per_season) * 100)
        
        if (isNaN(maxDiscountInCents) || maxDiscountInCents <= 0) {
          setError('Please enter a valid maximum discount amount')
          setLoading(false)
          return
        }
      }

      const categoryData = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        accounting_code: formData.accounting_code.trim().toUpperCase(),
        max_discount_per_user_per_season: maxDiscountInCents,
        is_active: formData.is_active,
      }

      const response = await fetch('/api/admin/discount-categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(categoryData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to create category')
      } else {
        router.push('/admin/discount-categories')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Check for duplicate names and accounting codes
  const categoryNameExists = existingCategories.some(category => 
    category.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  
  const accountingCodeExists = existingCategories.some(category => 
    category.accounting_code.toLowerCase() === formData.accounting_code.trim().toLowerCase()
  )
  
  const canCreateCategory = formData.name.trim() && 
                           formData.accounting_code.trim() &&
                           !categoryNameExists &&
                           !accountingCodeExists

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Create New Discount Category</h1>
            <p className="mt-1 text-sm text-gray-600">
              Set up an organizational discount category with accounting integration
            </p>
          </div>

          {/* Info Notice */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Organizational Discount Categories</h3>
                <p className="mt-2 text-sm text-blue-700">
                  Categories group discount codes by organization purpose (e.g., Scholarship Fund, Board Member, Volunteer) and set spending limits per user per season.
                </p>
              </div>
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
                  placeholder="e.g., Scholarship Fund, Board Member, Volunteer"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  A descriptive name for this discount category
                </p>
              </div>

              {/* Accounting Code */}
              <AccountingCodeInput
                value={formData.accounting_code}
                onChange={(value) => setFormData(prev => ({ ...prev, accounting_code: value }))}
                label="Accounting Code"
                required
                placeholder="Search for accounting code..."
                accountType="EXPENSE"
              />

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., Need-based scholarships for community members"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Optional description of this discount category's purpose
                </p>
              </div>

              {/* Max Discount Per User Per Season */}
              <div>
                <label htmlFor="max_discount" className="block text-sm font-medium text-gray-700">
                  Maximum Discount Per User Per Season (USD)
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                    type="number"
                    id="max_discount"
                    step="0.01"
                    min="1"
                    value={formData.max_discount_per_user_per_season}
                    onChange={(e) => setFormData(prev => ({ ...prev, max_discount_per_user_per_season: e.target.value }))}
                    className="block w-full pl-7 pr-12 border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="1.00"
                  />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Leave blank for no limit. This sets the total discount amount a user can receive in this category per season.
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
                  Category is active (discount codes in this category can be used)
                </label>
              </div>

              {/* Duplicate Warnings */}
              {categoryNameExists && (
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
                      <p className="text-sm text-yellow-700">A category with the accounting code "{formData.accounting_code.toUpperCase()}" already exists</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Category Preview */}
              {formData.name && (
                <div className={`border rounded-md p-4 ${(categoryNameExists || accountingCodeExists) ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Category Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Name</dt>
                      <dd className="text-sm text-gray-900">{formData.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Accounting Code</dt>
                      <dd className="text-sm text-gray-900">{formData.accounting_code.toUpperCase() || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Description</dt>
                      <dd className="text-sm text-gray-900">{formData.description || 'No description'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Spending Limit</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.max_discount_per_user_per_season 
                          ? `$${parseFloat(formData.max_discount_per_user_per_season).toFixed(2)} per season`
                          : 'No limit'
                        }
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Status</dt>
                      <dd className="text-sm text-gray-900">{formData.is_active ? 'Active' : 'Inactive'}</dd>
                    </div>
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
                  disabled={loading || !canCreateCategory}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateCategory && !loading
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
                  {loading ? 'Creating Category...' : canCreateCategory ? 'Create Category' : 'Complete Form to Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}