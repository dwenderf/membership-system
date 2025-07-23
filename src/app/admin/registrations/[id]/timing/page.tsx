'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function EditRegistrationTimingPage() {
  const router = useRouter()
  const params = useParams()
  const registrationId = params.id as string
  const supabase = createClient()
  
  const [registration, setRegistration] = useState<any>(null)
  const [formData, setFormData] = useState({
    is_active: false,
    presale_start_at: '',
    regular_start_at: '',
    registration_end_at: '',
    presale_code: '',
    allow_lgbtq_presale: true,
  })
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch registration details
  useEffect(() => {
    const fetchData = async () => {
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
        
        // Convert timestamps to local datetime-local format
        const formatForInput = (timestamp: string | null) => {
          if (!timestamp) return ''
          const date = new Date(timestamp)
          // Convert to local timezone and format for datetime-local input
          const year = date.getFullYear()
          const month = String(date.getMonth() + 1).padStart(2, '0')
          const day = String(date.getDate()).padStart(2, '0')
          const hours = String(date.getHours()).padStart(2, '0')
          const minutes = String(date.getMinutes()).padStart(2, '0')
          return `${year}-${month}-${day}T${hours}:${minutes}`
        }
        
        setFormData({
          is_active: regData.is_active || false,
          presale_start_at: formatForInput(regData.presale_start_at),
          regular_start_at: formatForInput(regData.regular_start_at),
          registration_end_at: formatForInput(regData.registration_end_at),
          presale_code: regData.presale_code || '',
          allow_lgbtq_presale: regData.allow_lgbtq_presale !== false, // Default to true if not set
        })
      }
    }
    
    fetchData()
  }, [registrationId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setLoading(true)
    setError('')

    try {
      // Convert datetime-local strings to ISO timestamps
      const formatForDB = (dateTimeLocal: string) => {
        if (!dateTimeLocal) return null
        return new Date(dateTimeLocal).toISOString()
      }

      // Validate date order
      const presaleDate = formData.presale_start_at ? new Date(formData.presale_start_at) : null
      const regularDate = formData.regular_start_at ? new Date(formData.regular_start_at) : null
      const endDate = formData.registration_end_at ? new Date(formData.registration_end_at) : null

      // Check date order: presale < regular < end
      if (presaleDate && regularDate && presaleDate >= regularDate) {
        setError('Pre-sale start date must be before general registration start date')
        setLoading(false)
        return
      }
      
      if (regularDate && endDate && regularDate >= endDate) {
        setError('General registration start date must be before registration end date')
        setLoading(false)
        return
      }
      
      if (presaleDate && endDate && presaleDate >= endDate) {
        setError('Pre-sale start date must be before registration end date')
        setLoading(false)
        return
      }

      const updateData = {
        is_active: formData.is_active,
        presale_start_at: formatForDB(formData.presale_start_at),
        regular_start_at: formatForDB(formData.regular_start_at),
        registration_end_at: formatForDB(formData.registration_end_at),
        presale_code: formData.presale_code.trim() || null,
        allow_lgbtq_presale: formData.allow_lgbtq_presale,
      }

      const { error: updateError } = await supabase
        .from('registrations')
        .update(updateData)
        .eq('id', registrationId)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
      } else {
        // Keep loading state active during navigation
        router.push(`/admin/registrations/${registrationId}`)
      }
    } catch {
      setError('An unexpected error occurred')
      setLoading(false)
    }
  }

  if (!registration) {
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
            <h1 className="text-3xl font-bold text-gray-900">Edit Registration Timing</h1>
            <p className="mt-1 text-sm text-gray-600">
              Configure when registration opens and closes for "{registration?.name}"
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

              {/* Active Status */}
              <div className={`border rounded-md p-4 ${
                formData.is_active 
                  ? 'bg-green-50 border-green-200' 
                  : 'bg-yellow-50 border-yellow-200'
              }`}>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="is_active" className={`ml-3 text-sm font-medium ${
                    formData.is_active ? 'text-green-800' : 'text-yellow-800'
                  }`}>
                    Publish this registration (make visible to users)
                  </label>
                </div>
                <p className={`mt-2 text-sm ${
                  formData.is_active ? 'text-green-700' : 'text-yellow-700'
                }`}>
                  {formData.is_active 
                    ? "Registration is published and visible to users (subject to timing restrictions below)."
                    : "Registration is in draft mode and hidden from all users."
                  }
                </p>
              </div>

              {/* Info Section */}
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-800">How Registration Timing Works</h3>
                    <div className="mt-2 text-sm text-blue-700">
                      <ul className="list-disc list-inside space-y-1">
                        <li><strong>Pre-sale:</strong> Early access with a special code</li>
                        <li><strong>General:</strong> Open to all users</li>
                        <li><strong>End:</strong> Registration closes automatically</li>
                        <li>Leave fields empty to disable timing restrictions</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pre-sale Start */}
              <div>
                <label htmlFor="presale_start_at" className="block text-sm font-medium text-gray-700">
                  Pre-sale Start Date & Time (optional)
                </label>
                <input
                  type="datetime-local"
                  id="presale_start_at"
                  value={formData.presale_start_at}
                  onChange={(e) => setFormData(prev => ({ ...prev, presale_start_at: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                <p className="mt-1 text-sm text-gray-500">
                  When pre-sale registration opens (requires pre-sale code)
                </p>
                {formData.presale_start_at && formData.regular_start_at && 
                 new Date(formData.presale_start_at) >= new Date(formData.regular_start_at) && (
                  <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <p className="text-sm text-yellow-800">
                      ⚠ Pre-sale start must be before general registration start
                    </p>
                  </div>
                )}
              </div>

              {/* LGBTQ Pre-sale Access */}
              {formData.presale_start_at && (
                <div className="border rounded-md p-4 bg-purple-50 border-purple-200">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="allow_lgbtq_presale"
                      checked={formData.allow_lgbtq_presale}
                      onChange={(e) => setFormData(prev => ({ ...prev, allow_lgbtq_presale: e.target.checked }))}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <label htmlFor="allow_lgbtq_presale" className="ml-3 text-sm font-medium text-purple-800">
                      Allow LGBTQ+ members to register in pre-sale without code
                    </label>
                  </div>
                  <p className="mt-2 text-sm text-purple-700">
                    {formData.allow_lgbtq_presale 
                      ? "LGBTQ+ members can register during pre-sale period without entering a pre-sale code."
                      : "LGBTQ+ members must enter a pre-sale code to register during pre-sale period."
                    }
                  </p>
                </div>
              )}

              {/* Pre-sale Code */}
              <div>
                <label htmlFor="presale_code" className="block text-sm font-medium text-gray-700">
                  Pre-sale Code (optional)
                </label>
                <input
                  type="text"
                  id="presale_code"
                  value={formData.presale_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, presale_code: e.target.value.toUpperCase() }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm uppercase"
                  placeholder="e.g., EARLY2024"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Code required for pre-sale access (automatically converted to uppercase)
                </p>
              </div>

              {/* Regular Start */}
              <div>
                <label htmlFor="regular_start_at" className="block text-sm font-medium text-gray-700">
                  General Registration Start Date & Time (optional)
                </label>
                <input
                  type="datetime-local"
                  id="regular_start_at"
                  value={formData.regular_start_at}
                  onChange={(e) => setFormData(prev => ({ ...prev, regular_start_at: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                <p className="mt-1 text-sm text-gray-500">
                  When registration opens to all users
                </p>
                {formData.regular_start_at && formData.registration_end_at && 
                 new Date(formData.regular_start_at) >= new Date(formData.registration_end_at) && (
                  <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <p className="text-sm text-yellow-800">
                      ⚠ General registration start must be before registration end date
                    </p>
                  </div>
                )}
              </div>

              {/* Registration End */}
              <div>
                <label htmlFor="registration_end_at" className="block text-sm font-medium text-gray-700">
                  Registration End Date & Time (optional)
                </label>
                <input
                  type="datetime-local"
                  id="registration_end_at"
                  value={formData.registration_end_at}
                  onChange={(e) => setFormData(prev => ({ ...prev, registration_end_at: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                <p className="mt-1 text-sm text-gray-500">
                  When registration closes
                </p>
                {formData.presale_start_at && formData.registration_end_at && 
                 new Date(formData.presale_start_at) >= new Date(formData.registration_end_at) && (
                  <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <p className="text-sm text-yellow-800">
                      ⚠ Registration end date must be after pre-sale start date
                    </p>
                  </div>
                )}
              </div>

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
                  disabled={loading}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {loading ? 'Updating Timing...' : 'Update Timing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}