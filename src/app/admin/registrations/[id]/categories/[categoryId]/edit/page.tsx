'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import AccountingCodeInput from '@/components/admin/AccountingCodeInput'

export default function EditRegistrationCategoryPage() {
  const router = useRouter()
  const params = useParams()
  const registrationId = params.id as string
  const categoryId = params.categoryId as string
  const supabase = createClient()
  
  const [registration, setRegistration] = useState<{
    id: string
    name: string
    type: string
  } | null>(null)
  const [category, setCategory] = useState<any>(null)
  const [formData, setFormData] = useState({
    category_id: '',     // Selected from master categories
    custom_name: '',     // For one-off custom categories
    price: '',           // Price in cents
    max_capacity: '',
    accounting_code: '',
    required_membership_id: '',  // Category-specific membership requirement
    sort_order: '',
  })
  const [priceDisplay, setPriceDisplay] = useState('')
  
  const [availableCategories, setAvailableCategories] = useState<{
    id: string
    name: string
    category_type: string
  }[]>([])
  const [availableMemberships, setAvailableMemberships] = useState<{
    id: string
    name: string
    price_monthly: number
    price_annual: number
  }[]>([])
  const [isCustom, setIsCustom] = useState(false)
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch registration details, category data, available master categories, and memberships
  useEffect(() => {
    const fetchData = async () => {
      // Get registration details
      const { data: regData, error: regError } = await supabase
        .from('registrations')
        .select(`
          *,
          seasons (
            id,
            name
          )
        `)
        .eq('id', registrationId)
        .single()
      
      if (!regError && regData) {
        setRegistration(regData)
      }

      // Get current category data
      const { data: categoryData, error: categoryError } = await supabase
        .from('registration_categories')
        .select(`
          *,
          categories (
            id,
            name,
            description,
            category_type
          ),
          memberships (
            id,
            name
          )
        `)
        .eq('id', categoryId)
        .single()

      if (!categoryError && categoryData) {
        setCategory(categoryData)
        
        // Set form data from existing category
        const isCustomCategory = categoryData.custom_name !== null
        setIsCustom(isCustomCategory)
        
        setFormData({
          category_id: categoryData.category_id || '',
          custom_name: categoryData.custom_name || '',
          price: categoryData.price !== null && categoryData.price !== undefined ? categoryData.price.toString() : '',
          max_capacity: categoryData.max_capacity ? categoryData.max_capacity.toString() : '',
          accounting_code: categoryData.accounting_code || '',
          required_membership_id: categoryData.required_membership_id || '',
          sort_order: categoryData.sort_order ? categoryData.sort_order.toString() : '',
        })
        
        // Set price display - handle zero values properly
        if (categoryData.price !== null && categoryData.price !== undefined) {
          setPriceDisplay((categoryData.price / 100).toFixed(2))
        }
      }

      // Fetch all membership types
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('memberships')
        .select('id, name, price_monthly, price_annual')
        .order('name')
      
      if (!membershipsError && membershipsData) {
        setAvailableMemberships(membershipsData)
      }

      // Get available master categories (system + user categories)
      const { data: masterCategories, error: masterError } = await supabase
        .from('categories')
        .select('*')
        .order('category_type, name')
      
      if (!masterError && masterCategories) {
        setAvailableCategories(masterCategories)
      }
    }
    
    fetchData()
  }, [registrationId, categoryId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canUpdateCategory) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      const categoryData = {
        category_id: isCustom ? null : (formData.category_id || null),
        custom_name: isCustom ? (formData.custom_name || null) : null,
        price: parseInt(formData.price),
        max_capacity: formData.max_capacity ? parseInt(formData.max_capacity) : null,
        accounting_code: formData.accounting_code.trim(),
        required_membership_id: formData.required_membership_id === 'none' ? null : (formData.required_membership_id || null),
        sort_order: parseInt(formData.sort_order) || 0,
      }

      const { error: updateError } = await supabase
        .from('registration_categories')
        .update(categoryData)
        .eq('id', categoryId)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
      } else {
        // Keep loading state active during navigation
        router.push(`/admin/registrations/${registrationId}`)
        // Don't set loading to false here - let the navigation handle it
      }
    } catch {
      setError('An unexpected error occurred')
      setLoading(false)
    }
  }

  const canUpdateCategory = (
    (isCustom && formData.custom_name.trim()) || 
    (!isCustom && formData.category_id)
  ) && 
  formData.price !== undefined && formData.price !== '' && parseInt(formData.price) >= 0 &&
  formData.accounting_code.trim()

  if (!category || !registration) {
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
            <h1 className="text-3xl font-bold text-gray-900">Edit Registration Category</h1>
            <p className="mt-1 text-sm text-gray-600">
              Update category for "{registration?.name}"
            </p>
          </div>

          {/* Form */}
          <div className="bg-white shadow rounded-lg">
            <form onSubmit={handleSubmit} className="space-y-6 p-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
                  {error}
                </div>
              )}

              {/* Category Selection Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category Type
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={!isCustom}
                      onChange={() => setIsCustom(false)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm text-gray-900">Standard Category</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={isCustom}
                      onChange={() => setIsCustom(true)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm text-gray-900">Custom Category</span>
                  </label>
                </div>
              </div>

              {/* Standard Category Selection */}
              {!isCustom && (
                <div>
                  <label htmlFor="category_id" className="block text-sm font-medium text-gray-700">
                    Select Category
                  </label>
                  <select
                    id="category_id"
                    value={formData.category_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, category_id: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    required={!isCustom}
                  >
                    <option value="">Select a category</option>
                    <optgroup label="System Categories">
                      {availableCategories.filter(cat => cat.category_type === 'system').map(category => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </optgroup>
                    {availableCategories.some(cat => cat.category_type === 'user') && (
                      <optgroup label="Your Categories">
                        {availableCategories.filter(cat => cat.category_type === 'user').map(category => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              )}

              {/* Custom Category Name */}
              {isCustom && (
                <div>
                  <label htmlFor="custom_name" className="block text-sm font-medium text-gray-700">
                    Custom Category Name
                  </label>
                  <input
                    type="text"
                    id="custom_name"
                    value={formData.custom_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, custom_name: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="e.g., Special Guest, Team Parent"
                    required={isCustom}
                  />
                </div>
              )}

              {/* Price */}
              <div>
                <label htmlFor="price" className="block text-sm font-medium text-gray-700">
                  Price
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                    type="text"
                    id="price"
                    value={priceDisplay}
                    onChange={(e) => setPriceDisplay(e.target.value)}
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value === '') {
                        setFormData(prev => ({ ...prev, price: '' }))
                        setPriceDisplay('')
                        return
                      }
                      
                      const dollars = parseFloat(value)
                      if (!isNaN(dollars) && dollars >= 0) {
                        const cents = Math.round(dollars * 100)
                        setFormData(prev => ({ ...prev, price: cents.toString() }))
                        setPriceDisplay(dollars.toFixed(2))
                      } else {
                        // Invalid input, reset to previous valid value
                        if (formData.price) {
                          setPriceDisplay((parseInt(formData.price) / 100).toFixed(2))
                        } else {
                          setPriceDisplay('')
                        }
                      }
                    }}
                    className="pl-7 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Enter price (e.g., 25.00)"
                    required
                  />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Registration fee for this category in dollars (required)
                </p>
              </div>

              {/* Max Capacity */}
              <div>
                <label htmlFor="max_capacity" className="block text-sm font-medium text-gray-700">
                  Maximum Capacity (optional)
                </label>
                <input
                  type="number"
                  id="max_capacity"
                  min="1"
                  value={formData.max_capacity}
                  onChange={(e) => setFormData(prev => ({ ...prev, max_capacity: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., 20"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Leave empty for unlimited capacity
                </p>
              </div>

              {/* Required Membership */}
              <div>
                <label htmlFor="required_membership_id" className="block text-sm font-medium text-gray-700">
                  Required Membership
                </label>
                <select
                  id="required_membership_id"
                  value={formData.required_membership_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, required_membership_id: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="">Select a membership</option>
                  {availableMemberships.map((membership) => (
                    <option key={membership.id} value={membership.id}>
                      {membership.name}
                    </option>
                  ))}
                  <option value="none">No membership required</option>
                </select>
              </div>

              {/* Accounting Code */}
              <AccountingCodeInput
                value={formData.accounting_code}
                onChange={(value) => setFormData(prev => ({ ...prev, accounting_code: value }))}
                label="Accounting Code"
                required
                placeholder="Search for accounting code..."
                accountType="REVENUE"
              />


              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <Link
                  href={`/admin/registrations/${registrationId}`}
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