'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import EmailChangeModal from '@/components/EmailChangeModal'

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
  const [showEmailChangeModal, setShowEmailChangeModal] = useState(false)
  const [googleOAuth, setGoogleOAuth] = useState<{ email: string; id: string } | null>(null)
  const [hasEmailAuth, setHasEmailAuth] = useState(false)
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

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

      // Check OAuth and email auth status
      const { data: identitiesData } = await supabase.auth.getUserIdentities()
      const identities = identitiesData?.identities || []

      // Check for Google OAuth
      const googleIdentity = identities.find(id => id.provider === 'google')
      if (googleIdentity) {
        setGoogleOAuth({
          email: googleIdentity.identity_data?.email || '',
          id: googleIdentity.id
        })
      }

      // Check for email auth (magic link/PIN capability)
      const emailIdentity = identities.find(id => id.provider === 'email')
      setHasEmailAuth(!!emailIdentity)

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
          // Import the Xero contact function and client utilities
          const { syncContactOnNameChange } = await import('@/lib/xero/contacts')
          const { getActiveTenant } = await import('@/lib/xero/client')
          
          // Get active Xero tenant using the client utility
          const activeTenant = await getActiveTenant()

          if (activeTenant) {
            console.log(`🔗 Found active Xero tenant: ${activeTenant.tenant_name} (${activeTenant.tenant_id})`)
            
            const xeroResult = await syncContactOnNameChange(
              user.id,
              activeTenant.tenant_id,
              originalFormData.firstName,
              originalFormData.lastName,
              formData.firstName.trim(),
              formData.lastName.trim()
            )
            
            if (xeroResult.success && xeroResult.xeroContactId) {
              console.log(`✅ Xero contact synced successfully: ${xeroResult.xeroContactId}`)
            } else {
              console.warn(`⚠️ Xero contact sync failed: ${xeroResult.error}`)
            }
          } else {
            console.log('ℹ️ No active Xero connection found, skipping contact sync')
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

  const handleChangeEmailClick = async () => {
    // Open email change modal (it will handle OAuth/email auth checks)
    setShowEmailChangeModal(true)
  }

  const handleEmailChangeSuccess = async () => {
    // Refresh user data from auth
    const { data: { user: updatedUser } } = await supabase.auth.getUser()

    if (!updatedUser) {
      console.error('Failed to get updated user after email change')
      return
    }

    setUser(updatedUser)

    // Get updated profile data
    const { data: userProfile } = await supabase
      .from('users')
      .select('*')
      .eq('id', updatedUser.id)
      .single()

    if (userProfile) {
      setFormData({
        firstName: userProfile.first_name || '',
        lastName: userProfile.last_name || '',
        isGoalie: userProfile.is_goalie,
        isLgbtq: userProfile.is_lgbtq,
      })
      setOriginalFormData({
        firstName: userProfile.first_name || '',
        lastName: userProfile.last_name || '',
        email: userProfile.email || '',
      })
    }

    // Refresh server components without full page reload
    router.refresh()
  }

  const handleUnlinkGoogle = async () => {
    if (!googleOAuth) return

    setUnlinking(true)
    try {
      const { error } = await supabase.auth.unlinkIdentity({ identity_id: googleOAuth.id })

      if (error) {
        console.error('Failed to unlink Google account:', error)
        showError('Failed to unlink Google account', error.message)
      } else {
        // Verify email authentication still exists after unlinking (prevent account lockout)
        const { data: identitiesData } = await supabase.auth.getUserIdentities()
        const identities = identitiesData?.identities || []
        const emailIdentity = identities.find(id => id.provider === 'email')

        if (!emailIdentity) {
          // This should never happen due to pre-check, but safeguard against race conditions
          console.error('CRITICAL: Email authentication missing after Google unlink')
          showError('Account Lockout Prevented', 'Unable to unlink Google - email authentication is missing. Please contact support.')

          // Note: The unlink already happened, but user still has Google auth in Supabase
          // They may need to re-link or contact support
          return
        }

        showSuccess('Google account unlinked', 'You can now only sign in with your email address.')
        setGoogleOAuth(null)
        setHasEmailAuth(true) // Confirm email auth is still present
        setShowUnlinkConfirm(false)
      }
    } catch (error) {
      console.error('Error unlinking Google account:', error)
      showError('Error', 'An unexpected error occurred')
    } finally {
      setUnlinking(false)
    }
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
          {/* Email Display with Change Button */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <div className="flex items-center justify-between">
              <div className="flex-1 p-3 bg-gray-50 border border-gray-300 rounded-md text-gray-900">
                {user?.email}
              </div>
              <button
                type="button"
                onClick={handleChangeEmailClick}
                className="ml-3 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Change Email
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              You can update your email address. We'll send a confirmation link to your new email to verify the change.
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

      {/* Account Security Section */}
      {googleOAuth && hasEmailAuth && (
        <div className="max-w-2xl bg-white shadow rounded-lg mt-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Account Security</h2>
            <p className="mt-1 text-sm text-gray-600">
              Manage your authentication methods
            </p>
          </div>

          <div className="px-6 py-4">
            {/* Google Authentication */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Google Authentication
              </label>
              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-300 rounded-md">
                <div className="flex items-center">
                  <svg className="w-5 h-5 mr-3 text-gray-600" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Google">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Connected</p>
                    <p className="text-sm text-gray-600">{googleOAuth.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUnlinkConfirm(true)}
                  className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Unlink
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Make sure you can sign in with your email address before unlinking Google.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Unlink Confirmation Modal */}
      {showUnlinkConfirm && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          onClick={() => setShowUnlinkConfirm(false)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlink-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" role="img" aria-label="Warning">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
              </div>
              <h3 id="unlink-modal-title" className="ml-3 text-lg font-medium text-gray-900">Unlink Google Account</h3>
            </div>

            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to unlink your Google account (<strong>{googleOAuth?.email}</strong>)?
              You'll only be able to sign in with your email address after this.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowUnlinkConfirm(false)}
                disabled={unlinking}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnlinkGoogle}
                disabled={unlinking}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
              >
                {unlinking ? 'Unlinking...' : 'Unlink Google Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Change Modal */}
      <EmailChangeModal
        isOpen={showEmailChangeModal}
        onClose={() => setShowEmailChangeModal(false)}
        currentEmail={user?.email || ''}
        onSuccess={handleEmailChangeSuccess}
      />
    </div>
  )
} 