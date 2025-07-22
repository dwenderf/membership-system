'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
}

interface DeleteAccountSectionProps {
  user: User
}

export default function DeleteAccountSection({ user }: DeleteAccountSectionProps) {
  const [showInitialWarning, setShowInitialWarning] = useState(false)
  const [showFinalConfirmation, setShowFinalConfirmation] = useState(false)
  const [confirmationText, setConfirmationText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  
  const router = useRouter()
  const { showSuccess, showError } = useToast()

  const handleDeleteAccount = async () => {
    if (confirmationText !== 'DELETE MY ACCOUNT') {
      showError('Confirmation failed', 'Please type "DELETE MY ACCOUNT" exactly as shown')
      return
    }

    setIsDeleting(true)

    try {
      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete account')
      }

      // Show success message
      showSuccess('Account deleted successfully', 'A confirmation email has been sent to your email address')
      
      // Redirect to login after short delay
      setTimeout(() => {
        router.push('/auth/login')
      }, 2000)

    } catch (error: any) {
      console.error('Account deletion error:', error)
      showError('Account deletion failed', error.message || 'An error occurred while deleting your account')
      setIsDeleting(false)
    }
  }

  const resetFlow = () => {
    setShowInitialWarning(false)
    setShowFinalConfirmation(false)
    setConfirmationText('')
    setIsDeleting(false)
  }

  if (showFinalConfirmation) {
    return (
      <div className="border-t pt-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 w-full">
              <h3 className="text-lg font-medium text-red-800 mb-4">
                🚨 Are you absolutely sure?
              </h3>
              <p className="text-sm text-red-700 mb-4">
                This action will <strong>permanently delete your account</strong> and cannot be undone.
                All your personal information will be anonymized and you will lose access to:
              </p>
              <ul className="text-sm text-red-700 mb-6 list-disc list-inside space-y-1">
                <li>All current memberships and registrations</li>
                <li>Account history and preferences</li>
                <li>Access to the hockey association system</li>
              </ul>
              
              <div className="mb-4">
                <label htmlFor="confirmation" className="block text-sm font-medium text-red-800 mb-2">
                  Type <strong>"DELETE MY ACCOUNT"</strong> to confirm:
                </label>
                <input
                  type="text"
                  id="confirmation"
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="block w-full px-3 py-2 border border-red-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
                  disabled={isDeleting}
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={resetFlow}
                  disabled={isDeleting}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px] text-center"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || confirmationText !== 'DELETE MY ACCOUNT'}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px] text-center"
                >
                  {isDeleting ? 'Deleting Account...' : 'Permanently Delete Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (showInitialWarning) {
    return (
      <div className="border-t pt-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 w-full">
              <h3 className="text-lg font-medium text-yellow-800 mb-4">
                ⚠️ Delete Your Account
              </h3>
              <p className="text-sm text-yellow-700 mb-4">
                This will permanently delete your account and all associated data.
              </p>
              
              <div className="mb-4">
                <p className="text-sm font-medium text-yellow-800 mb-2">You will lose access to:</p>
                <ul className="text-sm text-yellow-700 list-disc list-inside space-y-1">
                  <li>Your current memberships</li>
                  <li>Your team and event registrations</li>
                  <li>All account history and preferences</li>
                  <li>Any stored payment methods</li>
                </ul>
              </div>

              <p className="text-sm text-yellow-700 mb-6">
                <strong>This action cannot be undone.</strong> If you want to use this system again in the future, 
                you'll need to create a completely new account.
              </p>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowInitialWarning(false)}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium min-w-[120px] text-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowFinalConfirmation(true)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium min-w-[120px] text-center"
                >
                  Continue to Delete Account
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Delete Account</h3>
          <p className="text-sm text-gray-500">Permanently delete your account and all data</p>
        </div>
        <button
          onClick={() => setShowInitialWarning(true)}
          className="bg-white hover:bg-gray-50 text-red-600 border border-red-300 hover:border-red-400 px-4 py-2 rounded-md text-sm font-medium min-w-[120px] text-center transition-colors"
        >
          Delete Account
        </button>
      </div>
    </div>
  )
}