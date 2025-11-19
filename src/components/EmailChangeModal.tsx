'use client'

import { useState } from 'react'
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
  const [step, setStep] = useState<'request' | 'verify' | 'success'>('request')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()

  if (!isOpen) return null

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const handleSendCode = async () => {
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
      const response = await fetch('/api/user/email/send-verification-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail })
      })

      const data = await response.json()

      if (response.ok) {
        setStep('verify')
        showSuccess('Verification code sent!', 'Check your new email address for the 6-digit code.')
      } else {
        setError(data.error || 'Failed to send verification code')
        showError('Failed to send verification code', data.error)
      }
    } catch (error) {
      console.error('Error sending verification code:', error)
      setError('An unexpected error occurred')
      showError('Error', 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code from your email')
      return
    }

    setIsVerifying(true)
    setError(null)

    try {
      const response = await fetch('/api/user/email/verify-and-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail, code })
      })

      const data = await response.json()

      if (response.ok) {
        setStep('success')
        showSuccess('Email updated successfully!')
        setTimeout(() => {
          onSuccess()
          handleClose()
        }, 2000)
      } else {
        setError(data.error || 'Invalid verification code')
        showError('Verification failed', data.error)
      }
    } catch (error) {
      console.error('Error verifying code:', error)
      setError('An unexpected error occurred')
      showError('Error', 'An unexpected error occurred')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleClose = () => {
    setStep('request')
    setNewEmail('')
    setCode('')
    setError(null)
    onClose()
  }

  const getTitle = () => {
    switch (step) {
      case 'request': return 'Change Email Address'
      case 'verify': return 'Verify New Email'
      case 'success': return 'Email Updated!'
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
            disabled={isLoading || isVerifying}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {step === 'request' && (
          <div className="mb-6">
            <p className="text-sm text-gray-700 mb-4">
              Enter your new email address. We'll send a verification code to confirm the change.
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

            <p className="text-xs text-gray-500 mb-4">
              Note: You'll need to enter a 6-digit code sent to your new email address. Do not click any links in the email.
            </p>

            <button
              onClick={handleSendCode}
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
                'Send Verification Code'
              )}
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div className="mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
              <p className="text-sm text-blue-800">
                We've sent a 6-digit code to <strong>{newEmail}</strong>. Enter it below to confirm your new email address.
              </p>
            </div>

            <label htmlFor="verification-code" className="block text-sm font-medium text-gray-700 mb-2">
              Verification Code
            </label>
            <input
              id="verification-code"
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-center text-2xl tracking-widest mb-4"
              disabled={isVerifying}
            />

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              onClick={handleVerifyCode}
              disabled={isVerifying || code.length !== 6}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed mb-2"
            >
              {isVerifying ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Verifying...
                </span>
              ) : (
                'Verify and Update Email'
              )}
            </button>

            <button
              onClick={handleSendCode}
              disabled={isLoading}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
            >
              Resend Code
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="mb-6">
            <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">Email successfully updated!</h3>
                  <div className="mt-2 text-sm text-green-700">
                    <p>Your email has been changed from:</p>
                    <p className="font-medium mt-1">{currentEmail}</p>
                    <p className="mt-1">to:</p>
                    <p className="font-semibold mt-1">{newEmail}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
