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
  
  const [registration, setRegistration] = useState<any>(null)
  const [existingCategories, setExistingCategories] = useState<any[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    max_capacity: '',
    accounting_code: '',
    sort_order: '',
  })
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch registration details and existing categories
  useEffect(() => {
    const fetchData = async () => {
      // Get registration details
      const { data: regData, error: regError } = await supabase
        .from('registrations')
        .select('*')
        .eq('id', registrationId)
        .single()
      
      if (!regError && regData) {
        setRegistration(regData)
      }

      // Get existing categories
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('registration_categories')
        .select('*')
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
        name: formData.name,
        max_capacity: formData.max_capacity ? parseInt(formData.max_capacity) : null,
        current_count: 0,
        accounting_code: formData.accounting_code || null,
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
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handlePresetClick = (preset: { name: string; suggested_capacity: number }) => {
    setFormData(prev => ({
      ...prev,
      name: preset.name,
      max_capacity: preset.suggested_capacity.toString(),
      accounting_code: `${registration?.type?.toUpperCase()}-${preset.name?.toUpperCase()}` || '',
    }))
    setShowPresets(false)
  }

  const handleAddAllPresets = async () => {
    if (!registration) return
    
    setLoading(true)
    setError('')

    try {
      const presets = CATEGORY_PRESETS[registration.type as keyof typeof CATEGORY_PRESETS] || []
      const categoriesToAdd = presets.map((preset, index) => ({
        registration_id: registrationId,
        name: preset.name,
        max_capacity: preset.suggested_capacity,
        current_count: 0,
        accounting_code: `${registration?.type?.toUpperCase()}-${preset.name?.toUpperCase()}`,
        sort_order: existingCategories.length + index,
      }))

      const { error: insertError } = await supabase
        .from('registration_categories')
        .insert(categoriesToAdd)

      if (insertError) {
        setError(insertError.message)
      } else {
        router.push(`/admin/registrations/${registrationId}`)
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Check for duplicate category name
  const categoryNameExists = existingCategories.some(category => 
    category.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  
  const canCreateCategory = formData.name.trim() && 
                           (!formData.max_capacity || parseInt(formData.max_capacity) > 0) &&
                           !categoryNameExists

  const availablePresets = registration 
    ? CATEGORY_PRESETS[registration.type as keyof typeof CATEGORY_PRESETS] || []
    : []

  const unusedPresets = availablePresets.filter(preset =>
    !existingCategories.some(cat => cat.name.toLowerCase() === preset.name.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Add Registration Category</h1>
            <p className="mt-1 text-sm text-gray-600">
              Create a new category for "{registration?.name}"
            </p>
          </div>

          {/* Quick Actions */}
          {unusedPresets.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h3 className="text-sm font-medium text-blue-800">Quick Setup</h3>
                  <div className="mt-2">
                    <p className="text-sm text-blue-700">
                      We have some common categories for {registration?.type} registrations:
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unusedPresets.map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => handlePresetClick(preset)}
                          className="inline-flex items-center px-3 py-1 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50"
                        >
                          {preset.name} ({preset.suggested_capacity})
                        </button>
                      ))}
                      {unusedPresets.length > 1 && (
                        <button
                          onClick={handleAddAllPresets}
                          disabled={loading}
                          className="inline-flex items-center px-3 py-1 border border-blue-600 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                        >
                          Add All
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

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
                  placeholder="e.g., Player, Goalie, Alternate"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  What type of participant is this? (e.g., Player, Goalie, Alternate, Guest)
                </p>
              </div>

              {/* Duplicate Name Warning */}
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
                      <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                        <li>A category with the name "{formData.name}" already exists</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Max Capacity */}
              <div>
                <label htmlFor="max_capacity" className="block text-sm font-medium text-gray-700">
                  Maximum Capacity
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
                  Leave empty for unlimited capacity, or set a maximum number of participants for this category
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
                  placeholder="e.g., TEAM-PLAYER"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Optional code for accounting system integration
                </p>
              </div>

              {/* Sort Order */}
              <div>
                <label htmlFor="sort_order" className="block text-sm font-medium text-gray-700">
                  Display Order
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
                  Order in which this category appears (0 = first, higher numbers appear later)
                </p>
              </div>

              {/* Preview */}
              {formData.name && (
                <div className={`border rounded-md p-4 ${categoryNameExists ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Category Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Name</dt>
                      <dd className="text-sm text-gray-900">{formData.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Capacity</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.max_capacity ? `${formData.max_capacity} spots` : 'Unlimited'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Accounting Code</dt>
                      <dd className="text-sm text-gray-900">{formData.accounting_code || 'None'}</dd>
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
                  className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateCategory && !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {loading ? 'Creating...' : canCreateCategory ? 'Create Category' : 'Complete Form to Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}