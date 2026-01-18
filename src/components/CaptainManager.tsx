'use client'

import { useState, useEffect } from 'react'

interface Captain {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  email_notifications: boolean
}

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
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
  const [users, setUsers] = useState<User[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCaptains()
    fetchUsers()
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

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/admin/users?limit=1000')
      if (!response.ok) throw new Error('Failed to fetch users')
      const data = await response.json()
      setUsers(data.users || [])
    } catch (err) {
      console.error('Error fetching users:', err)
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
      setSearchTerm('')
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

  // Filter users for search (exclude already-captains)
  const captainUserIds = new Set(captains.map(c => c.user_id))
  const availableUsers = users.filter(u => !captainUserIds.has(u.id))

  const filteredUsers = searchTerm.length >= 2
    ? availableUsers.filter(user => {
        const search = searchTerm.toLowerCase()
        return (
          user.email.toLowerCase().includes(search) ||
          user.first_name?.toLowerCase().includes(search) ||
          user.last_name?.toLowerCase().includes(search)
        )
      }).slice(0, 5)
    : []

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
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Add Captain
        </label>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by name or email..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
          disabled={adding}
        />

        {/* Search Results Dropdown */}
        {filteredUsers.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredUsers.map((user) => (
              <button
                key={user.id}
                onClick={() => handleAddCaptain(user.id)}
                disabled={adding}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none disabled:opacity-50"
              >
                <p className="text-sm font-medium text-gray-900">
                  {user.first_name} {user.last_name}
                </p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </button>
            ))}
          </div>
        )}

        {searchTerm.length >= 2 && filteredUsers.length === 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-3">
            <p className="text-sm text-gray-500">No users found</p>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Captains can view and manage team rosters. They will receive an email notification when assigned or removed.
      </p>
    </div>
  )
}
