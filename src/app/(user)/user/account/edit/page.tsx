'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'

export default function EditProfilePage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    isGoalie: null as boolean | null,
    isLgbtq: null as boolean | null,
  })
  const [originalFormData, setOriginalFormData] = useState({
    firstName: '',
    lastName: '',
    email: '', // Track email for future contact sync needs
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  
  const router = useRouter()
  const supabase = createClient()
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }

      // Get user profile data
      const { data: userProfile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!userProfile) {
        router.push('/user/account')
        return
      }

      setUser(user)
      const initialData = {
        firstName: userProfile.first_name || '',
        lastName: userProfile.last_name || '',
        isGoalie: userProfile.is_goalie,
        isLgbtq: userProfile.is_lgbtq,
      }
      setFormData(initialData)
      setOriginalFormData({
        firstName: userProfile.first_name || '',
        lastName: userProfile.last_name || '',
        email: user.email || '', // Track original email for future contact sync
      })
      setLoading(false)
    }

    getUser()
  }, [supabase.auth, router])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.firstName?.trim()) {
      newErrors.firstName = 'First name is required'
    }
    
    if (!formData.lastName?.trim()) {
      newErrors.lastName = 'Last name is required'
    }
    
    if (formData.isGoalie === null) {
      newErrors.isGoalie = 'Please answer whether you play goalie'
    }
    
    // Note: isLgbtq can be null (prefer not to answer) - no validation needed
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Check if form is valid for button enabling
  const isFormValid = () => {
    return (
      !!formData.firstName?.trim() &&
      !!formData.lastName?.trim() &&
      formData.isGoalie !== null
      // Note: isLgbtq can be null (prefer not to answer) - no validation needed
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setSubmitting(true)

    try {
      // Check for contact-relevant changes (name or email)
      const contactChanged = (
        originalFormData.firstName !== formData.firstName.trim() ||
        originalFormData.lastName !== formData.lastName.trim() ||
        originalFormData.email !== user.email // Future-proofing for email changes
      )

      const { error } = await supabase
        .from('users')
        .update({
          first_name: formData.firstName.trim(),
          last_name: formData.lastName.trim(),
          is_goalie: formData.isGoalie,
          is_lgbtq: formData.isLgbtq,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (error) throw error

      // If contact info changed (name or email), sync to Xero contact  
      if (contactChanged) {
        console.log('Contact info changed, syncing to Xero contact...')
        try {
          const response = await fetch('/api/xero/sync-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userData: {
                id: user.id,
                email: user.email,
                first_name: formData.firstName.trim(),
                last_name: formData.lastName.trim(),
                phone: null, // We don't collect phone in this form
                member_id: null // This will be fetched from the database by the API
              }
            }),
          })

          if (!response.ok) {
            console.warn('Xero contact sync failed, but profile update succeeded')
          } else {
            console.log('Xero contact synced successfully')
          }
        } catch (xeroError) {
          console.warn('Xero contact sync failed, but profile update succeeded:', xeroError)
          // Don't fail the entire operation if Xero sync fails
        }
      }

      showSuccess('Profile updated!', 'Your profile has been successfully updated.')
      router.push('/user/account')

    } catch (error: any) {
      console.error('Error updating profile:', error)
      const errorMessage = error?.message || 'Failed to update profile. Please try again.'
      setErrors({ submit: errorMessage })
      showError('Profile update failed', errorMessage)
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    router.push('/user/account')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Edit Profile</h1>
        <p className="mt-2 text-sm text-gray-600">
          Update your personal information and preferences
        </p>
      </div>
      
      <form className="max-w-2xl bg-white shadow rounded-lg" onSubmit={handleSubmit}>
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Personal Information</h2>
          <p className="mt-1 text-sm text-gray-600">
            Update your name and preferences
          </p>
        </div>
        
        <div className="px-6 py-4 space-y-6">
          {/* Email Display (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Email Address
            </label>
            <div className="mt-1 p-3 bg-gray-50 border border-gray-300 rounded-md text-gray-900">
              {user?.email}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Email address cannot be changed. Contact support if you need to update your email.
            </p>
          </div>

          {/* First Name */}
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
              First Name *
            </label>
            <input
              type="text"
              id="firstName"
              value={formData.firstName}
              onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                errors.firstName ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder="Enter your first name"
            />
            {errors.firstName && (
              <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>
            )}
          </div>

          {/* Last Name */}
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
              Last Name *
            </label>
            <input
              type="text"
              id="lastName"
              value={formData.lastName}
              onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                errors.lastName ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder="Enter your last name"
            />
            {errors.lastName && (
              <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>
            )}
          </div>

          {/* Goalie Question */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Do you play goalie? (select yes even if you primarily play out) *
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isGoalie"
                  value="true"
                  checked={formData.isGoalie === true}
                  onChange={() => setFormData(prev => ({ ...prev, isGoalie: true }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-3 text-sm text-gray-700">Yes</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isGoalie"
                  value="false"
                  checked={formData.isGoalie === false}
                  onChange={() => setFormData(prev => ({ ...prev, isGoalie: false }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-3 text-sm text-gray-700">No</span>
              </label>
            </div>
            {errors.isGoalie && (
              <p className="mt-1 text-sm text-red-600">{errors.isGoalie}</p>
            )}
          </div>

          {/* LGBTQ Question */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Do you identify as LGBTQ+? *
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isLgbtq"
                  value="true"
                  checked={formData.isLgbtq === true}
                  onChange={() => setFormData(prev => ({ ...prev, isLgbtq: true }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-3 text-sm text-gray-700">Yes</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isLgbtq"
                  value="false"
                  checked={formData.isLgbtq === false}
                  onChange={() => setFormData(prev => ({ ...prev, isLgbtq: false }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-3 text-sm text-gray-700">No</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isLgbtq"
                  value="null"
                  checked={formData.isLgbtq === null}
                  onChange={() => setFormData(prev => ({ ...prev, isLgbtq: null }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-3 text-sm text-gray-700">Prefer not to answer</span>
              </label>
            </div>
            {errors.isLgbtq && (
              <p className="mt-1 text-sm text-red-600">{errors.isLgbtq}</p>
            )}
          </div>

          {errors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-sm text-red-800">{errors.submit}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          
          <button
            type="submit"
            disabled={submitting || !isFormValid()}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
} 