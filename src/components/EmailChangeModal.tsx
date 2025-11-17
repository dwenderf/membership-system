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
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [newEmail, setNewEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()

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
      const response = await fetch('/api/user/email/request-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail })
      })

      const data = await response.json()

      if (response.ok) {
        setStep('verify')
        showSuccess('Verification code sent!', 'Check your email for the verification code.')
      } else {
        setError(data.error || 'Failed to send verification code')
        showError('Failed to send verification code', data.error)
      }
    } catch (error) {
      console.error('Error requesting email change:', error)
      setError('An unexpected error occurred')
      showError('Error', 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirmChange = async () => {
    setError(null)

    if (!verificationCode) {
      setError('Please enter the verification code')
      return
    }

    if (verificationCode.length !== 6) {
      setError('Verification code must be 6 digits')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/user/email/confirm-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationCode })
      })

      const data = await response.json()

      if (response.ok) {
        showSuccess('Email updated successfully!', 'Your email address has been changed.')
        onSuccess()
        handleClose()
      } else {
        setError(data.error || 'Invalid verification code')
        showError('Verification failed', data.error)
      }
    } catch (error) {
      console.error('Error confirming email change:', error)
      setError('An unexpected error occurred')
      showError('Error', 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    setError(null)
    setIsLoading(true)

    try {
      const response = await fetch('/api/user/email/request-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail })
      })

      const data = await response.json()

      if (response.ok) {
        showSuccess('Code resent!', 'Check your email for the new verification code.')
      } else {
        showError('Failed to resend code', data.error)
      }
    } catch (error) {
      console.error('Error resending code:', error)
      showError('Error', 'Failed to resend verification code')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setStep('request')
    setNewEmail('')
    setVerificationCode('')
    setError(null)
    onClose()
  }

  const handleCodeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    setVerificationCode(value)
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
              {step === 'request' ? 'Change Email Address' : 'Verify New Email'}
            </h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {step === 'request' ? (
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
                'Send Verification Code'
              )}
            </button>
          </div>
        ) : (
          <div className="mb-6">
            <p className="text-sm text-gray-700 mb-4">
              Enter the 6-digit verification code sent to <strong>{newEmail}</strong>
            </p>

            <div className="mb-4">
              <label htmlFor="verificationCode" className="block text-sm font-medium text-gray-700 mb-2">
                Verification Code
              </label>
              <input
                type="text"
                id="verificationCode"
                value={verificationCode}
                onChange={handleCodeInput}
                placeholder="000000"
                maxLength={6}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-center text-2xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <p className="mt-2 text-xs text-gray-500">
                Code expires in 15 minutes
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              onClick={handleConfirmChange}
              disabled={isLoading || verificationCode.length !== 6}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed mb-3"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Verifying...
                </span>
              ) : (
                'Confirm Email Change'
              )}
            </button>

            <button
              onClick={handleResend}
              disabled={isLoading}
              className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-blue-400"
            >
              Didn't receive code? Resend
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
