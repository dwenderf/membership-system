'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'

// Common category presets for different registration types
const CATEGORY_PRESETS = {
  team: [
    { name: 'Player', suggested_capacity: 20 },
    { name: 'Goalie', suggested_capacity: 2 },
    { name: 'Alternate', suggested_capacity: 5 },
  ],
  tournament: [
    { name: 'Player', suggested_capacity: 18 },
    { name: 'Goalie', suggested_capacity: 2 },
    { name: 'Guest', suggested_capacity: 10 },
  ],
  scrimmage: [
    { name: 'Player', suggested_capacity: 20 },
    { name: 'Goalie', suggested_capacity: 2 },
  ],
  event: [
    { name: 'Participant', suggested_capacity: 50 },
  ],
}

export default function NewRegistrationCategoryPage() {
  const router = useRouter()
  const params = useParams()
  const registrationId = params.id as string
  const supabase = createClient()
  
  const [registration, setRegistration] = useState<{
    id: string
    name: string
    type: string
  } | null>(null)
  const [existingCategories, setExistingCategories] = useState<{
    id: string
    registration_id: string
    category_id: string | null
    custom_name: string | null
    categories?: {
      id: string
      name: string
      description: string | null
      category_type: string
    }
  }[]>([])
  const [formData, setFormData] = useState({
    category_id: '',     // Selected from master categories
    custom_name: '',     // For one-off custom categories
    price: '',           // Price in cents, starts empty
    max_capacity: '',
    accounting_code: '',
    required_membership_id: '',  // Category-specific membership requirement
    sort_order: '',
  })
  const [priceDisplay, setPriceDisplay] = useState('')
  
  const [availableCategories, setAvailableCategories] = useState<{
    id: string
    name: string
    description: string | null
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

  // Fetch registration details, existing categories, available master categories, and memberships
  useEffect(() => {
    const fetchData = async () => {
      // Get registration details with season info
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
        
        // Fetch all membership types (no longer season-specific)
        const { data: membershipsData, error: membershipsError } = await supabase
          .from('memberships')
          .select('id, name, price_monthly, price_annual')
          .order('name')
        
        if (!membershipsError && membershipsData) {
          setAvailableMemberships(membershipsData)
        } else {
          // If no memberships available, default to "none"
          setFormData(prev => ({ ...prev, required_membership_id: 'none' }))
        }
      }

      // Get existing categories with their master category info
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('registration_categories')
        .select(`
          *,
          categories (
            id,
            name,
            description,
            category_type
          )
        `)
        .eq('registration_id', registrationId)
        .order('sort_order')
      
      if (!categoriesError && categoriesData) {
        setExistingCategories(categoriesData)
        // Set default sort order to be after existing categories
        setFormData(prev => ({ 
          ...prev, 
          sort_order: categoriesData.length.toString() 
        }))
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
  }, [registrationId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canCreateCategory) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      const categoryData = {
        registration_id: registrationId,
        category_id: isCustom ? null : (formData.category_id || null),
        custom_name: isCustom ? (formData.custom_name || null) : null,
        price: parseInt(formData.price),
        max_capacity: formData.max_capacity ? parseInt(formData.max_capacity) : null,
        accounting_code: formData.accounting_code.trim(),
        required_membership_id: formData.required_membership_id === 'none' ? null : (formData.required_membership_id || null),
        sort_order: parseInt(formData.sort_order) || 0,
      }

      const { error: insertError } = await supabase
        .from('registration_categories')
        .insert([categoryData])

      if (insertError) {
        setError(insertError.message)
      } else {
        router.push(`/admin/registrations/${registrationId}`)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handlePresetClick = (preset: { name: string; suggested_capacity: number }) => {
    // Look for a matching system category
    const matchingCategory = availableCategories.find(cat => 
      cat.category_type === 'system' && cat.name.toLowerCase() === preset.name.toLowerCase()
    )
    
    if (matchingCategory) {
      setFormData(prev => ({
        ...prev,
        category_id: matchingCategory.id,
        custom_name: '',
        max_capacity: preset.suggested_capacity.toString(),
        accounting_code: `${registration?.type?.toUpperCase()}-${preset.name?.toUpperCase()}` || '',
      }))
      setIsCustom(false)
    } else {
      // Fallback to custom if no system category found
      setFormData(prev => ({
        ...prev,
        category_id: '',
        custom_name: preset.name,
        max_capacity: preset.suggested_capacity.toString(),
        accounting_code: `${registration?.type?.toUpperCase()}-${preset.name?.toUpperCase()}` || '',
      }))
      setIsCustom(true)
    }
  }

  const handleAddAllPresets = async () => {
    if (!registration) return
    
    setLoading(true)
    setError('')

    try {
      const presets = CATEGORY_PRESETS[registration.type as keyof typeof CATEGORY_PRESETS] || []
      const categoriesToAdd = presets.map((preset, index) => {
        const matchingCategory = availableCategories.find(cat => 
          cat.category_type === 'system' && cat.name.toLowerCase() === preset.name.toLowerCase()
        )
        
        return {
          registration_id: registrationId,
          category_id: matchingCategory?.id || null,
          custom_name: matchingCategory ? null : preset.name,
          price: 0, // Default to $0, admin can update prices individually after creation
          max_capacity: preset.suggested_capacity,
          accounting_code: `${registration?.type?.toUpperCase()}-${preset.name?.toUpperCase()}`,
          sort_order: existingCategories.length + index,
        }
      })

      const { error: insertError } = await supabase
        .from('registration_categories')
        .insert(categoriesToAdd)

      if (insertError) {
        setError(insertError.message)
      } else {
        router.push(`/admin/registrations/${registrationId}`)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Check for duplicate category
  const categoryAlreadyExists = existingCategories.some(category => {
    if (isCustom) {
      return category.custom_name?.toLowerCase() === formData.custom_name.trim().toLowerCase()
    } else {
      return category.category_id === formData.category_id
    }
  })
  
  const canCreateCategory = (
    (isCustom && formData.custom_name.trim()) || 
    (!isCustom && formData.category_id)
  ) && 
  formData.price !== undefined && formData.price !== '' && parseInt(formData.price) >= 0 &&
  formData.accounting_code.trim() &&
  (!formData.max_capacity || parseInt(formData.max_capacity) > 0) &&
  !categoryAlreadyExists

  const availablePresets = registration 
    ? CATEGORY_PRESETS[registration.type as keyof typeof CATEGORY_PRESETS] || []
    : []

  const unusedPresets = availablePresets.filter(preset =>
    !existingCategories.some(cat => {
      const categoryName = cat.categories?.name || cat.custom_name || ''
      return categoryName.toLowerCase() === preset.name.toLowerCase()
    })
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Add Registration Category</h1>
            <p className="mt-1 text-sm text-gray-600">
              Create a new category for &quot;{registration?.name}&quot;
            </p>
          </div>

          {/* Quick Actions */}

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
                          {category.name} {category.description && `- ${category.description}`}
                        </option>
                      ))}
                    </optgroup>
                    {availableCategories.some(cat => cat.category_type === 'user') && (
                      <optgroup label="Your Categories">
                        {availableCategories.filter(cat => cat.category_type === 'user').map(category => (
                          <option key={category.id} value={category.id}>
                            {category.name} {category.description && `- ${category.description}`}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <p className="mt-1 text-sm text-gray-500">
                    Choose from standard participant categories
                  </p>
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
                  <p className="mt-1 text-sm text-gray-500">
                    Enter a custom name for this one-time category
                  </p>
                </div>
              )}

              {/* Duplicate Category Warning */}
              {categoryAlreadyExists && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                      <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                        <li>This category already exists for this registration</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

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
                {availableMemberships.length === 0 ? (
                  <div className="mt-1">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                      <div className="flex">
                        <div className="flex-shrink-0">
                          <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="ml-3">
                          <h3 className="text-sm font-medium text-yellow-800">No Membership Types Available</h3>
                          <div className="mt-2 text-sm text-yellow-700">
                            <p>No membership types have been created yet. You can either:</p>
                            <ul className="mt-1 list-disc list-inside">
                              <li>Set this category to require no membership</li>
                              <li>Create a membership type first</li>
                            </ul>
                          </div>
                          <div className="mt-4">
                            <button
                              type="button"
                              className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800 text-sm px-3 py-1 rounded border border-yellow-300"
                              onClick={() => window.open('/admin/memberships/new', '_blank')}
                            >
                              Create Membership Type
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <select
                      id="required_membership_id"
                      value="none"
                      onChange={() => {}}
                      disabled
                      className="mt-2 block w-full border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm"
                    >
                      <option value="none">No membership required</option>
                    </select>
                  </div>
                ) : (
                  <select
                    id="required_membership_id"
                    value={formData.required_membership_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, required_membership_id: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="">Select a membership</option>
                    {availableMemberships.map((membership) => (
                      <option key={membership.id} value={membership.id}>
                        {membership.name} - ${(membership.price_monthly / 100).toFixed(2)}/mo or ${(membership.price_annual / 100).toFixed(2)}/yr
                      </option>
                    ))}
                    <option value="none">No membership required</option>
                  </select>
                )}
                <p className="mt-1 text-sm text-gray-500">
                  {availableMemberships.length === 0 
                    ? 'No membership types available'
                    : 'Choose a membership type that users must have to register for this category'
                  }
                </p>
              </div>

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

              {/* Accounting Code */}
              <div>
                <label htmlFor="accounting_code" className="block text-sm font-medium text-gray-700">
                  Accounting Code
                </label>
                <input
                  type="text"
                  id="accounting_code"
                  value={formData.accounting_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, accounting_code: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Enter Accounting Code (required)"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  Required code for Xero integration and accounting system
                </p>
              </div>

              {/* Sort Order */}
              <div>
                <label htmlFor="sort_order" className="block text-sm font-medium text-gray-700">
                  Display Order (optional)
                </label>
                <input
                  type="number"
                  id="sort_order"
                  min="0"
                  value={formData.sort_order}
                  onChange={(e) => setFormData(prev => ({ ...prev, sort_order: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Order in which this category appears (defaults to last)
                </p>
              </div>

              {/* Preview */}
              {((!isCustom && formData.category_id) || (isCustom && formData.custom_name)) && (
                <div className={`border rounded-md p-4 ${categoryAlreadyExists ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Category Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Name</dt>
                      <dd className="text-sm text-gray-900">
                        {isCustom ? formData.custom_name : availableCategories.find(cat => cat.id === formData.category_id)?.name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Type</dt>
                      <dd className="text-sm text-gray-900">
                        {isCustom ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                            Custom
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Standard
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Capacity</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.max_capacity ? `${formData.max_capacity} spots` : 'Unlimited'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Required Membership</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.required_membership_id === 'none' ? 'None' :
                         formData.required_membership_id ? 
                          availableMemberships.find(m => m.id === formData.required_membership_id)?.name || 'Unknown' : 
                          'Not selected'
                        }
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Accounting Code</dt>
                      <dd className="text-sm text-gray-900">{formData.accounting_code || 'None'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Price</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.price ? `$${(parseInt(formData.price) / 100).toFixed(2)}` : 'Not set'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Display Order</dt>
                      <dd className="text-sm text-gray-900">{formData.sort_order || '0'}</dd>
                    </div>
                  </dl>
                </div>
              )}

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
                  disabled={loading || !canCreateCategory}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateCategory && !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
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