'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import { getOrganizationName } from '@/lib/organization'

export default function OnboardingPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    isGoalie: null as boolean | null,
    isLgbtq: undefined as boolean | null | undefined,
    termsAccepted: false,
    wantsMembership: true, // defaults to checked
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

      // Check if user already exists and is onboarded
      const { data: userData } = await supabase
        .from('users')
        .select('onboarding_completed_at')
        .eq('id', user.id)
        .single()

      if (userData?.onboarding_completed_at) {
        // Already onboarded, redirect to dashboard
        router.push('/dashboard')
        return
      }

      setUser(user)
      
      // Pre-populate form with any existing data
      if (user.user_metadata?.first_name || user.user_metadata?.full_name) {
        setFormData(prev => ({
          ...prev,
          firstName: user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || '',
          lastName: user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '',
        }))
      }
      
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
    
    if (formData.isLgbtq === null || formData.isLgbtq === undefined) {
      newErrors.isLgbtq = 'Please answer whether you identify as LGBTQ'
    }
    
    if (!formData.termsAccepted) {
      newErrors.termsAccepted = 'You must accept the terms and conditions to continue'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Check if form is valid for button enabling
  const isFormValid = () => {
    return (
      !!formData.firstName?.trim() &&
      !!formData.lastName?.trim() &&
      formData.isGoalie !== null &&
      formData.isLgbtq !== undefined &&
      formData.termsAccepted
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setSubmitting(true)

    try {
      // Check if user record exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .single()

      // Trim whitespace before saving to database
      const userData = {
        id: user.id,
        email: user.email!,
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        is_goalie: formData.isGoalie!,
        is_lgbtq: formData.isLgbtq,
        is_admin: false,
        onboarding_completed_at: new Date().toISOString(),
        terms_accepted_at: new Date().toISOString(),
        terms_version: 'v1.0',
      }

      if (existingUser) {
        // Update existing user
        const { error } = await supabase
          .from('users')
          .update({
            first_name: userData.first_name,
            last_name: userData.last_name,
            is_goalie: userData.is_goalie,
            is_lgbtq: userData.is_lgbtq,
            onboarding_completed_at: userData.onboarding_completed_at,
            terms_accepted_at: userData.terms_accepted_at,
            terms_version: userData.terms_version,
          })
          .eq('id', user.id)

        if (error) throw error
      } else {
        // Create new user
        const { error } = await supabase
          .from('users')
          .insert([userData])

        if (error) throw error
      }

      // Show success toast
      showSuccess('Profile completed!', `Welcome to the ${getOrganizationName('long').toLowerCase()}`)

      // Redirect based on membership preference (no delay needed)
      if (formData.wantsMembership) {
        router.push('/user/browse-memberships?onboarding=true')
      } else {
        router.push('/dashboard')
      }
      
      // Note: Don't reset submitting state on success - keep button disabled until redirect

    } catch (error: any) {
      console.error('Error completing onboarding:', error)
      const errorMessage = error?.message || 'Failed to complete onboarding. Please try again.'
      setErrors({ submit: errorMessage })
      showError('Profile completion failed', errorMessage)
      setSubmitting(false) // Only reset on error
    }
  }

  const handleCancel = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
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
    <div className="flex-1 bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to the {getOrganizationName('long')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Complete your profile to get started
          </p>
        </div>
        
        <form className="mt-8 space-y-6 bg-white p-8 rounded-lg shadow" onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Email Display */}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Email Address
              </label>
              <div className="mt-1 p-3 bg-gray-50 border border-gray-300 rounded-md text-gray-900">
                {user?.email}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                This email cannot be changed. If this is incorrect, please cancel and log in with the correct email.
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
                Do you identify as LGBTQ? *
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

            {/* Terms Acceptance */}
            <div className="space-y-3">
              <div className="flex items-start">
                <input
                  id="termsAccepted"
                  type="checkbox"
                  checked={formData.termsAccepted}
                  onChange={(e) => setFormData(prev => ({ ...prev, termsAccepted: e.target.checked }))}
                  className={`h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded ${
                    errors.termsAccepted ? 'border-red-300' : ''
                  }`}
                />
                <label htmlFor="termsAccepted" className="ml-3 text-sm text-gray-700">
                  I agree to the{' '}
                  <Link href="/terms" target="_blank" className="text-blue-600 hover:text-blue-800 underline">
                    Terms and Conditions
                  </Link>
                  ,{' '}
                  <Link href="/code-of-conduct" target="_blank" className="text-blue-600 hover:text-blue-800 underline">
                    Code of Conduct
                  </Link>
                  , and{' '}
                  <Link href="/privacy-policy" target="_blank" className="text-blue-600 hover:text-blue-800 underline">
                    Privacy Policy
                  </Link>
                  {' *'}
                </label>
              </div>
              {errors.termsAccepted && (
                <p className="text-sm text-red-600">{errors.termsAccepted}</p>
              )}
            </div>

            {/* Membership Interest */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-start">
                <input
                  id="wantsMembership"
                  type="checkbox"
                  checked={formData.wantsMembership}
                  onChange={(e) => setFormData(prev => ({ ...prev, wantsMembership: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-0.5"
                />
                <div className="ml-3">
                  <label htmlFor="wantsMembership" className="text-sm font-medium text-gray-900">
                    Purchase a membership now (recommended)
                  </label>
                  <p className="text-sm text-gray-600 mt-1">
                    Get access to teams, events, and exclusive member benefits. You can always purchase a membership later from your dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {errors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-sm text-red-800">{errors.submit}</p>
            </div>
          )}

          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            
            <button
              type="submit"
              disabled={submitting || !isFormValid()}
              className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Completing...' : 'Complete Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}