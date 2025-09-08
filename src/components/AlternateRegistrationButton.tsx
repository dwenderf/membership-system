'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface AlternateRegistrationButtonProps {
  registrationId: string
  registrationName: string
  isAlreadyRegistered: boolean
  isAlreadyAlternate: boolean
  allowAlternates: boolean
  alternatePrice: number | null
}

export default function AlternateRegistrationButton({
  registrationId,
  registrationName,
  isAlreadyRegistered,
  isAlreadyAlternate,
  allowAlternates,
  alternatePrice
}: AlternateRegistrationButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const supabase = createClient()

  const handleAlternateRegistration = async () => {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/user-alternate-registrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registration_id: registrationId
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to register as alternate')
      }

      setSuccess('Successfully registered as alternate!')
      // Refresh the page to show updated state
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveAlternate = async () => {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/user-alternate-registrations/${registrationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to remove alternate registration')
      }

      setSuccess('Alternate registration removed!')
      // Refresh the page to show updated state
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Don't show if alternates are not allowed
  if (!allowAlternates) {
    return null
  }

  // Show current status if already an alternate
  if (isAlreadyAlternate) {
    return (
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-blue-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-blue-800">
              You're registered as an alternate
            </span>
          </div>
          <p className="text-xs text-blue-700 mt-1">
            You'll be notified if selected for games. 
            {alternatePrice && ` Charge: $${(alternatePrice / 100).toFixed(2)} per game.`}
          </p>
        </div>
        
        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}
        
        {success && (
          <div className="text-green-600 text-sm">{success}</div>
        )}
        
        <button
          onClick={handleRemoveAlternate}
          disabled={loading}
          className="w-full bg-red-100 hover:bg-red-200 text-red-800 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? 'Removing...' : 'Remove Alternate Registration'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-green-50 border border-green-200 rounded-md p-3">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.293l-3-3a1 1 0 00-1.414 1.414L10.586 9.5 7.707 6.621a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium text-green-800">
            Register as Alternate
          </span>
        </div>
        <p className="text-xs text-green-700 mt-1">
          Be available to fill in for games when needed.
          {alternatePrice && ` You'll be charged $${(alternatePrice / 100).toFixed(2)} per game if selected.`}
          {isAlreadyRegistered && ' You can be an alternate even though you\'re already registered.'}
        </p>
      </div>
      
      {error && (
        <div className="text-red-600 text-sm">{error}</div>
      )}
      
      {success && (
        <div className="text-green-600 text-sm">{success}</div>
      )}
      
      <button
        onClick={handleAlternateRegistration}
        disabled={loading}
        className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
      >
        {loading ? 'Registering...' : 'Register as Alternate'}
      </button>
    </div>
  )
}