'use client'

import { useState, useEffect } from 'react'
import UserPicker from '@/components/admin/UserPicker'
import ConfirmationDialog from '@/components/ConfirmationDialog'

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
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [captainToRemove, setCaptainToRemove] = useState<{ id: string; name: string } | null>(null)

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

  const handleUserSelect = (userId: string, userName: string) => {
    setSelectedUser({ id: userId, name: userName })
    setConfirmDialogOpen(true)
  }

  const handleConfirmAddCaptain = async () => {
    if (!selectedUser) return

    try {
      setAdding(true)
      setError(null)

      const response = await fetch(`/api/admin/registrations/${registrationId}/captains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          registrationName,
          seasonName
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add captain')
      }

      await fetchCaptains()
      setConfirmDialogOpen(false)
      setSelectedUser(null)
    } catch (err) {
      console.error('Error adding captain:', err)
      setError(err instanceof Error ? err.message : 'Failed to add captain')
    } finally {
      setAdding(false)
    }
  }

  const handleCancelAddCaptain = () => {
    setConfirmDialogOpen(false)
    setSelectedUser(null)
  }

  const handleRemoveCaptain = (captainId: string, captainName: string) => {
    setCaptainToRemove({ id: captainId, name: captainName })
    setRemoveDialogOpen(true)
  }

  const handleConfirmRemoveCaptain = async () => {
    if (!captainToRemove) return

    try {
      setRemovingId(captainToRemove.id)
      setError(null)

      const response = await fetch(`/api/admin/registrations/${registrationId}/captains/${captainToRemove.id}`, {
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
      setRemoveDialogOpen(false)
      setCaptainToRemove(null)
    } catch (err) {
      console.error('Error removing captain:', err)
      setError(err instanceof Error ? err.message : 'Failed to remove captain')
    } finally {
      setRemovingId(null)
    }
  }

  const handleCancelRemoveCaptain = () => {
    setRemoveDialogOpen(false)
    setCaptainToRemove(null)
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
                onClick={() => handleRemoveCaptain(captain.id, `${captain.first_name} ${captain.last_name}`)}
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
        onSelect={handleUserSelect}
        excludeUserIds={captainUserIds}
        disabled={adding}
      />

      <p className="mt-2 text-xs text-gray-500">
        Captains can view and manage team rosters. They will receive an email notification when assigned or removed.
      </p>

      {/* Add Captain Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmDialogOpen}
        title="Add Captain"
        message={
          <div>
            <p>Are you sure you want to add <strong>{selectedUser?.name}</strong> as a captain for <strong>{registrationName}</strong>?</p>
            <p className="mt-2 text-sm text-gray-600">They will receive an email notification.</p>
          </div>
        }
        confirmText="Add Captain"
        cancelText="Cancel"
        onConfirm={handleConfirmAddCaptain}
        onCancel={handleCancelAddCaptain}
        isLoading={adding}
        variant="info"
      />

      {/* Remove Captain Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={removeDialogOpen}
        title="Remove Captain"
        message={
          <div>
            <p>Are you sure you want to remove <strong>{captainToRemove?.name}</strong> as a captain for <strong>{registrationName}</strong>?</p>
            <p className="mt-2 text-sm text-gray-600">They will receive an email notification.</p>
          </div>
        }
        confirmText="Remove Captain"
        cancelText="Cancel"
        onConfirm={handleConfirmRemoveCaptain}
        onCancel={handleCancelRemoveCaptain}
        isLoading={removingId === captainToRemove?.id}
        variant="danger"
      />
    </div>
  )
}
