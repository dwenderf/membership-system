'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'

interface EmailChangeModalProps {
  isOpen: boolean
  onClose: () => void
  currentEmail: string
  onSuccess: () => void
}

export default function EmailChangeModal({
  isOpen,
  onClose,
  currentEmail,
  onSuccess
}: EmailChangeModalProps) {
  const [step, setStep] = useState<'check_oauth' | 'request' | 'confirmation'>('check_oauth')
  const [newEmail, setNewEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [hasGoogleOAuth, setHasGoogleOAuth] = useState(false)
  const [hasEmailAuth, setHasEmailAuth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    if (isOpen) {
      checkAuthMethods()
    }
  }, [isOpen])

  const checkAuthMethods = async () => {
    setIsCheckingAuth(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: identitiesData } = await supabase.auth.getUserIdentities()
        const identities = identitiesData?.identities || []

        const googleIdentity = identities.find(id => id.provider === 'google')
        const emailIdentity = identities.find(id => id.provider === 'email')

        setHasGoogleOAuth(!!googleIdentity)
        setHasEmailAuth(!!emailIdentity)

        // If they have OAuth but no email auth, they need to establish email auth first
        // Otherwise, go directly to request (we'll handle OAuth unlinking automatically)
        if (googleIdentity && !emailIdentity) {
          setStep('check_oauth')
        } else {
          setStep('request')
        }
      }
    } catch (error) {
      console.error('Error checking auth methods:', error)
      showError('Error', 'Failed to check authentication methods')
    } finally {
      setIsCheckingAuth(false)
    }
  }

  const handleEstablishEmailAuth = async () => {
    setIsLoading(true)
    try {
      const supabase = createClient()

      // Send OTP code (not magic link)
      const { error } = await supabase.auth.signInWithOtp({
        email: currentEmail,
        options: {
          shouldCreateUser: false
        }
      })

      if (error) {
        showError('Failed to send verification code', error.message)
        setIsLoading(false)
        return
      }

      // Store email and preference in sessionStorage for verify-otp page
      sessionStorage.setItem('otp_email', currentEmail)
      sessionStorage.setItem('auth_method_preference', 'otp')

      // Log the user out
      await supabase.auth.signOut()

      // Show success message
      showSuccess(
        'Check your email!',
        'We\'ve logged you out. Enter the 6-digit code on the next page.'
      )

      // Redirect to verify-otp page
      window.location.href = '/auth/verify-otp'
    } catch (error) {
      console.error('Error sending verification code:', error)
      showError('Error', 'Failed to send verification code')
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const handleRequestChange = async () => {
    setError(null)

    // Validate email
    if (!newEmail) {
      setError('Please enter a new email address')
      return
    }

    if (!validateEmail(newEmail)) {
      setError('Please enter a valid email address')
      return
    }

    if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setError('New email must be different from current email')
      return
    }

    setIsLoading(true)

    try {
      // If user has Google OAuth, unlink it first to prevent email mismatch
      if (hasGoogleOAuth) {
        const supabase = createClient()
        const { data: identitiesData } = await supabase.auth.getUserIdentities()
        const identities = identitiesData?.identities || []
        const googleIdentity = identities.find(id => id.provider === 'google')

        if (googleIdentity) {
          const { error: unlinkError } = await supabase.auth.unlinkIdentity(googleIdentity)
          if (unlinkError) {
            setError('Failed to unlink Google account')
            showError('Failed to unlink Google', unlinkError.message)
            setIsLoading(false)
            return
          }
          setHasGoogleOAuth(false)
        }
      }

      const response = await fetch('/api/user/email/request-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail })
      })

      const data = await response.json()

      if (response.ok) {
        setStep('confirmation')
        showSuccess('Confirmation email sent!', 'Check both your current and new email addresses for confirmation links.')
      } else {
        setError(data.error || 'Failed to request email change')
        showError('Failed to request email change', data.error)
      }
    } catch (error) {
      console.error('Error requesting email change:', error)
      setError('An unexpected error occurred')
      showError('Error', 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setStep('check_oauth')
    setNewEmail('')
    setError(null)
    onClose()
  }

  const getTitle = () => {
    switch (step) {
      case 'check_oauth': return 'Email Change Setup'
      case 'request': return 'Change Email Address'
      case 'confirmation': return 'Check Your Email'
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-25 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-6 border w-full max-w-md shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="ml-3 text-lg font-medium text-gray-900">
              {getTitle()}
            </h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading || isCheckingAuth}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {isCheckingAuth && step === 'check_oauth' && (
          <div className="mb-6 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="ml-3 text-sm text-gray-600">Checking authentication methods...</p>
          </div>
        )}

        {!isCheckingAuth && step === 'check_oauth' && hasGoogleOAuth && !hasEmailAuth && (
          <div className="mb-6">
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Email Changes Not Available</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>You're currently signed in with Google only. Due to technical limitations with how authentication identities work, email changes are not available for Google-only accounts.</p>
                    <p className="mt-3"><strong>Your options:</strong></p>
                    <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
                      <li>Create a new account with your desired email address</li>
                      <li>Contact support for assistance with account migration</li>
                    </ul>
                    <p className="mt-3 text-xs">
                      <strong>Why this limitation exists:</strong> Google OAuth and email authentication are separate identity systems. Your account was created through Google and doesn't have an email identity required for secure email changes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Close
            </button>
          </div>
        )}


        {step === 'request' && (
          <div className="mb-6">
            {hasGoogleOAuth && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">Google Account Will Be Unlinked</h3>
                    <div className="mt-2 text-sm text-yellow-700">
                      <p>To prevent security issues and confusion, your Google account will be automatically unlinked when you change your email.</p>
                      <p className="mt-2">After changing your email, you'll only be able to sign in with your new email address (not Google). You can re-link Google later if desired.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <p className="text-sm text-gray-700 mb-4">
              Enter your new email address. We'll send confirmation links to both your current and new email addresses to verify the change.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Email
              </label>
              <div className="bg-gray-50 p-3 rounded-md">
                <p className="text-sm text-gray-900">{currentEmail}</p>
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="newEmail" className="block text-sm font-medium text-gray-700 mb-2">
                New Email Address
              </label>
              <input
                type="email"
                id="newEmail"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Enter new email address"
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              onClick={handleRequestChange}
              disabled={isLoading || !newEmail}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                </span>
              ) : (
                'Request Email Change'
              )}
            </button>
          </div>
        )}

        {step === 'confirmation' && (
          <div className="mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">Confirmation emails sent!</h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <p className="mb-2">We've sent confirmation links to:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li><strong>{currentEmail}</strong> (current email)</li>
                      <li><strong>{newEmail}</strong> (new email)</li>
                    </ul>
                    <p className="mt-3">
                      <strong>Important:</strong> You must click the confirmation links in <strong>both</strong> emails to complete the email change.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-700">
                    Check your spam folders if you don't see the emails within a few minutes.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
