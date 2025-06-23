'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface EditableRegistrationNameProps {
  registrationId: string
  initialName: string
}

export default function EditableRegistrationName({ 
  registrationId, 
  initialName 
}: EditableRegistrationNameProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const handleSave = async () => {
    if (name.trim() === initialName) {
      setIsEditing(false)
      return
    }

    if (!name.trim()) {
      setError('Name cannot be empty')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { error: updateError } = await supabase
        .from('registrations')
        .update({ name: name.trim() })
        .eq('id', registrationId)

      if (updateError) {
        setError(updateError.message)
      } else {
        setIsEditing(false)
        // Refresh the page to show updated name
        window.location.reload()
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setName(initialName)
    setIsEditing(false)
    setError('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (isEditing) {
    return (
      <div className="flex-1">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="text-3xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none focus:border-blue-600"
            autoFocus
            disabled={loading}
          />
          <div className="flex items-center space-x-1">
            <button
              onClick={handleSave}
              disabled={loading || !name.trim()}
              className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
              title="Save"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
              title="Cancel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Press Enter to save, Escape to cancel
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-center space-x-2">
      <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
      <button
        onClick={() => setIsEditing(true)}
        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
        title="Edit registration name"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
    </div>
  )
}