'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'

interface ReauthenticationModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  userEmail: string
}

export default function ReauthenticationModal({
  isOpen,
  onClose,
  onSuccess,
  userEmail
}: ReauthenticationModalProps) {
  const [linkSent, setLinkSent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { showSuccess, showError } = useToast()

  if (!isOpen) return null

  const handleSendMagicLink = async () => {
    setIsLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: userEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/user/account?reauthenticated=true`
        }
      })

      if (error) {
        showError('Failed to send verification link', error.message)
      } else {
        setLinkSent(true)
        showSuccess('Verification link sent!', 'Check your email and click the link to continue.')
      }
    } catch (error) {
      console.error('Error sending magic link:', error)
      showError('Failed to send verification link', 'Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Check if user has reauthenticated
  const checkReauthentication = () => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('reauthenticated') === 'true') {
      // Remove the parameter from URL
      window.history.replaceState({}, '', window.location.pathname)
      onSuccess()
    }
  }

  // Check on mount and when window regains focus
  if (typeof window !== 'undefined' && linkSent) {
    window.addEventListener('focus', checkReauthentication)
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-25 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-6 border w-full max-w-md shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="ml-3 text-lg font-medium text-gray-900">Verify Your Identity</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-700 mb-4">
            For security reasons, you must verify your identity before changing your email address.
          </p>

          {!linkSent ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                We'll send a verification link to:
              </p>
              <div className="bg-gray-50 p-3 rounded-md mb-4">
                <p className="text-sm font-medium text-gray-900">{userEmail}</p>
              </div>
              <button
                onClick={handleSendMagicLink}
                disabled={isLoading}
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
                  `Send Verification Link`
                )}
              </button>
            </>
          ) : (
            <>
              <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">Verification link sent!</h3>
                    <p className="mt-2 text-sm text-green-700">
                      Check your email and click the link. Once verified, you'll be able to continue with changing your email address.
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
