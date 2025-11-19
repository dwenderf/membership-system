'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'

export default function EmailChangedPage() {
  const [processing, setProcessing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    const handleEmailChange = async () => {
      try {
        const supabase = createClient()

        // Get the current user (Supabase has already updated auth.users)
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

        if (authError || !authUser) {
          setError('Unable to verify email change. Please log in again.')
          setProcessing(false)
          return
        }

        const newEmail = authUser.email

        if (!newEmail) {
          setError('Unable to get new email address.')
          setProcessing(false)
          return
        }

        // Check for OAuth/email mismatch and unlink if necessary
        const { data: identitiesData } = await supabase.auth.getUserIdentities()
        const identities = identitiesData?.identities || []
        const googleIdentity = identities.find(id => id.provider === 'google')

        if (googleIdentity) {
          // Google OAuth email won't match the new email, so unlink it for security
          console.log('Google OAuth detected after email change, unlinking for security...')
          const { error: unlinkError } = await supabase.auth.unlinkIdentity(googleIdentity)
          if (unlinkError) {
            console.error('Failed to unlink Google OAuth:', unlinkError)
            // Don't fail the entire process, just log it
          } else {
            console.log('Google OAuth unlinked successfully')
          }
        }

        // Get user data from users table to get old email
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('email, first_name')
          .eq('id', authUser.id)
          .single()

        if (userError || !userData) {
          setError('Unable to retrieve user data.')
          setProcessing(false)
          return
        }

        const oldEmail = userData.email

        // If emails match, the users table is already updated
        if (oldEmail === newEmail) {
          showSuccess('Email already updated!', 'Your email address has been changed.')
          setTimeout(() => router.push('/user/account/edit'), 2000)
          return
        }

        // Sync the email change to our users table and Xero
        const response = await fetch('/api/user/email/sync-change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldEmail, newEmail })
        })

        const data = await response.json()

        if (response.ok && data.success) {
          showSuccess('Email updated successfully!', 'Your email address has been changed.')

          // Redirect to account edit page after 2 seconds
          setTimeout(() => {
            router.push('/user/account/edit')
          }, 2000)
        } else {
          setError(data.error || 'Failed to complete email change')
          showError('Email change incomplete', data.error)
          setProcessing(false)
        }

      } catch (err) {
        console.error('Error processing email change:', err)
        setError('An unexpected error occurred')
        showError('Error', 'An unexpected error occurred')
        setProcessing(false)
      }
    }

    handleEmailChange()
  }, [router, showSuccess, showError])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">Email Change Failed</h1>
          <p className="text-center text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/user/account/edit')}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Return to Account Settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full mb-4">
          <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">Updating Email Address</h1>
        <p className="text-center text-gray-600">
          {processing ? 'Please wait while we update your account...' : 'Done!'}
        </p>
      </div>
    </div>
  )
}
