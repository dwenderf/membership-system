'use client'

import { useState, useEffect } from 'react'
import UserPicker from '@/components/admin/UserPicker'

interface Captain {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
}

interface CaptainManagerProps {
  registrationId: string
  registrationName: string
  seasonName: string
}

export default function CaptainManager({
  registrationId,
  registrationName,
  seasonName
}: CaptainManagerProps) {
  const [captains, setCaptains] = useState<Captain[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCaptains()
  }, [registrationId])

  const fetchCaptains = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/admin/registrations/${registrationId}/captains`)
      if (!response.ok) throw new Error('Failed to fetch captains')
      const data = await response.json()
      setCaptains(data.captains || [])
    } catch (err) {
      console.error('Error fetching captains:', err)
      setError('No captains assigned')
    } finally {
      setLoading(false)
    }
  }

  const handleAddCaptain = async (userId: string) => {
    try {
      setAdding(true)
      setError(null)

      const response = await fetch(`/api/admin/registrations/${registrationId}/captains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          registrationName,
          seasonName
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add captain')
      }

      await fetchCaptains()
    } catch (err) {
      console.error('Error adding captain:', err)
      setError(err instanceof Error ? err.message : 'Failed to add captain')
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveCaptain = async (captainId: string) => {
    if (!confirm('Are you sure you want to remove this captain? They will receive an email notification.')) {
      return
    }

    try {
      setRemovingId(captainId)
      setError(null)

      const response = await fetch(`/api/admin/registrations/${registrationId}/captains/${captainId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationName,
          seasonName
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove captain')
      }

      await fetchCaptains()
    } catch (err) {
      console.error('Error removing captain:', err)
      setError(err instanceof Error ? err.message : 'Failed to remove captain')
    } finally {
      setRemovingId(null)
    }
  }

  // Get captain user IDs to exclude from picker
  const captainUserIds = captains.map(c => c.user_id)

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Captains</h2>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Current Captains */}
      {loading ? (
        <div className="text-sm text-gray-500">Loading captains...</div>
      ) : captains.length === 0 ? (
        <div className="text-sm text-gray-500 mb-4">No captains assigned</div>
      ) : (
        <div className="space-y-2 mb-4">
          {captains.map((captain) => (
            <div
              key={captain.id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded-md"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {captain.first_name} {captain.last_name}
                </p>
                <p className="text-xs text-gray-500 truncate">{captain.email}</p>
              </div>
              <button
                onClick={() => handleRemoveCaptain(captain.id)}
                disabled={removingId === captain.id}
                className="ml-2 text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50"
              >
                {removingId === captain.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Captain Search */}
      <UserPicker
        label="Add Captain"
        onSelect={handleAddCaptain}
        excludeUserIds={captainUserIds}
        disabled={adding}
      />

      <p className="mt-2 text-xs text-gray-500">
        Captains can view and manage team rosters. They will receive an email notification when assigned or removed.
      </p>
    </div>
  )
}
