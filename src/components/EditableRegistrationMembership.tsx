'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface EditableRegistrationMembershipProps {
  registrationId: string
  initialMembershipId: string | null
}

export default function EditableRegistrationMembership({
  registrationId,
  initialMembershipId,
}: EditableRegistrationMembershipProps) {
  const supabase = createClient()
  const [isEditing, setIsEditing] = useState(false)
  const [membershipId, setMembershipId] = useState(initialMembershipId || '')
  const [availableMemberships, setAvailableMemberships] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchMemberships = async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('id, name')
        .order('name')

      if (!error && data) {
        setAvailableMemberships(data)
      }
    }
    fetchMemberships()
  }, [])

  const handleSave = async () => {
    setLoading(true)
    setError('')

    const { error: updateError } = await supabase
      .from('registrations')
      .update({ required_membership_id: membershipId || null })
      .eq('id', registrationId)

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
    } else {
      setIsEditing(false)
      setLoading(false)
      window.location.reload() // Refresh to show updated value
    }
  }

  const handleCancel = () => {
    setMembershipId(initialMembershipId || '')
    setIsEditing(false)
    setError('')
  }

  const selectedMembership = availableMemberships.find(m => m.id === membershipId)

  if (isEditing) {
    return (
      <div className="space-y-2">
        <select
          value={membershipId}
          onChange={(e) => setMembershipId(e.target.value)}
          className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          disabled={loading}
        >
          <option value="">None (optional)</option>
          {availableMemberships.map((membership) => (
            <option key={membership.id} value={membership.id}>
              {membership.name}
            </option>
          ))}
        </select>

        <p className="text-xs text-gray-500">
          Optional default requirement. Categories can offer alternatives.
        </p>

        {error && (
          <div className="text-sm text-red-600">{error}</div>
        )}

        <div className="flex space-x-2">
          <button
            onClick={handleSave}
            disabled={loading}
            className="text-sm text-blue-600 hover:text-blue-500 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={loading}
            className="text-sm text-gray-600 hover:text-gray-500 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center space-x-2">
      <span className="text-sm text-gray-900">
        {selectedMembership ? selectedMembership.name : 'None (optional)'}
      </span>
      <button
        onClick={() => setIsEditing(true)}
        className="text-sm text-blue-600 hover:text-blue-500"
      >
        Edit
      </button>
    </div>
  )
}
