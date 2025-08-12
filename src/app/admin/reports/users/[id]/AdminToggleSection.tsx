'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'

interface AdminToggleSectionProps {
  userId: string
  isAdmin: boolean
  isViewingOwnProfile: boolean
  userName: string
}

export default function AdminToggleSection({ 
  userId, 
  isAdmin, 
  isViewingOwnProfile, 
  userName 
}: AdminToggleSectionProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { showSuccess, showError } = useToast()
  const router = useRouter()

  const handleToggleAdmin = async () => {
    setIsLoading(true)
    
    try {
      const response = await fetch(`/api/admin/users/${userId}/toggle-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (response.ok && data.success) {
        showSuccess(data.message || `Admin access ${data.is_admin ? 'granted' : 'revoked'} successfully`)
        // Refresh the page to show updated status
        router.refresh()
      } else {
        showError(data.error || 'Failed to update admin status')
      }
    } catch (error) {
      console.error('Error toggling admin status:', error)
      showError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Account Actions</h2>
        <p className="mt-1 text-sm text-gray-600">
          Manage user account settings and permissions
        </p>
      </div>
      <div className="px-6 py-4">
        <div className="space-y-4">
          {/* Admin Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Admin Access</h3>
              <p className="text-sm text-gray-500">
                {isViewingOwnProfile 
                  ? 'You cannot modify your own admin status'
                  : 'Grant or revoke administrative privileges'
                }
              </p>
            </div>
            {!isViewingOwnProfile && (
              <button
                onClick={handleToggleAdmin}
                disabled={isLoading}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isLoading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : isAdmin
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isLoading 
                  ? 'Updating...' 
                  : isAdmin 
                  ? 'Remove Admin Access' 
                  : 'Grant Admin Access'
                }
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
