'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'

type PageState = 'loading' | 'pending' | 'complete' | 'error'

export default function EmailChangedPage() {
  const [state, setState] = useState<PageState>('loading')
  const [oldEmail, setOldEmail] = useState<string>('')
  const [newEmail, setNewEmail] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { showSuccess, showError } = useToast()
  const hasRun = useRef(false)

  useEffect(() => {
    // Prevent running multiple times
    if (hasRun.current) {
      console.log('DEBUG: useEffect blocked by hasRun.current')
      return
    }
    hasRun.current = true
    console.log('DEBUG: useEffect running for the first time')

    let redirectTimeout: NodeJS.Timeout | null = null

    const handleEmailChange = async () => {
      try {
        const supabase = createClient()

        // Get the current user
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

        if (authError || !authUser) {
          setError('Unable to verify email change. Please log in again.')
          setState('error')
          return
        }

        // Get user data from users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('email, first_name')
          .eq('id', authUser.id)
          .single()

        if (userError || !userData) {
          setError('Unable to retrieve user data.')
          setState('error')
          return
        }

        // DEBUG: Log the current state
        console.log('DEBUG email-changed page:', {
          authUserEmail: authUser.email,
          authUserNewEmail: authUser.new_email,
          userDataEmail: userData.email,
          emailVerifiedAt: authUser.email_confirmed_at,
          userIdentities: authUser.identities?.length
        })

        // Check if email change is still pending (first confirmation clicked)
        if (authUser.new_email) {
          // Email change is pending - only one confirmation clicked
          console.log('DEBUG: Detected PENDING state - showing One More Step')
          setOldEmail(userData.email)
          setNewEmail(authUser.new_email)
          setState('pending')
          return
        }

        // Check if email change is complete (both confirmations clicked)
        if (authUser.email && authUser.email !== userData.email) {
          console.log('DEBUG: Detected COMPLETE state - syncing to database')
          // Email change is complete! Sync to database and Xero
          setOldEmail(userData.email)
          setNewEmail(authUser.email)

          // Sync the email change to our users table and Xero
          const response = await fetch('/api/user/email/sync-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldEmail: userData.email, newEmail: authUser.email })
          })

          const data = await response.json()

          if (response.ok && data.success) {
            setState('complete')
            showSuccess('Email updated successfully!', 'Your email address has been changed.')

            // Redirect to account edit page after 3 seconds
            redirectTimeout = setTimeout(() => {
              router.push('/user/account/edit')
            }, 3000)
          } else {
            setError(data.error || 'Failed to complete email change')
            showError('Email change incomplete', data.error)
            setState('error')
          }
        } else {
          // Email already synced or no change detected
          console.log('DEBUG: No email change detected - showing error')
          setError('No pending email change found.')
          setState('error')
        }

      } catch (err) {
        console.error('Error processing email change:', err)
        setError('An unexpected error occurred')
        showError('Error', 'An unexpected error occurred')
        setState('error')
      }
    }

    handleEmailChange()

    // Cleanup function to prevent memory leaks
    return () => {
      if (redirectTimeout) {
        clearTimeout(redirectTimeout)
      }
    }
  }, [])

  // Error state
  if (state === 'error') {
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

  // Pending state - only one email confirmed
  if (state === 'pending') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full mb-4">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-center text-gray-900 mb-4">One More Step!</h1>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <p className="text-sm text-blue-900 mb-3">
              You've successfully verified one email address. To complete your email change, you need to verify the other email address.
            </p>
            <p className="text-sm text-blue-900 font-medium mb-2">
              Please check <strong>both</strong> of these inboxes for confirmation emails:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-blue-900 ml-2">
              <li><strong>{oldEmail}</strong> (current email)</li>
              <li><strong>{newEmail}</strong> (new email)</li>
            </ul>
            <p className="text-sm text-blue-900 mt-3">
              Click the confirmation link in whichever email you haven't verified yet.
            </p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  Don't see the email? Check your spam folder. The confirmation links expire in 24 hours.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => router.push('/user/account/edit')}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Return to Account Settings
          </button>
        </div>
      </div>
    )
  }

  // Complete state
  if (state === 'complete') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-green-100 rounded-full mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">Email Updated Successfully!</h1>
          <div className="text-center text-gray-600 mb-4">
            <p className="mb-2">Your email address has been changed from:</p>
            <p className="text-sm"><span className="line-through text-gray-400">{oldEmail}</span></p>
            <p className="text-sm">to</p>
            <p className="text-sm font-semibold text-blue-600">{newEmail}</p>
          </div>
          <p className="text-center text-sm text-gray-500 mb-6">
            Redirecting you back to your account settings...
          </p>
        </div>
      </div>
    )
  }

  // Loading state
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full mb-4">
          <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">Processing Email Change</h1>
        <p className="text-center text-gray-600">
          Please wait while we verify your email change...
        </p>
      </div>
    </div>
  )
}
