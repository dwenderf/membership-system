'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Season {
  id: string
  name: string
  type: string
  start_date: string
  end_date: string
}

interface Membership {
  id: string
  name: string
  price: number
  season_id: string
}

interface MembershipSetupFormProps {
  season: Season
  availableMemberships: Membership[]
  hasExistingMemberships: boolean
}

export default function MembershipSetupForm({ 
  season, 
  availableMemberships, 
  hasExistingMemberships 
}: MembershipSetupFormProps) {
  const router = useRouter()
  const supabase = createClient()
  
  const [selectedAction, setSelectedAction] = useState<'assign' | 'create' | ''>('')
  const [selectedMembershipId, setSelectedMembershipId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filter out memberships already assigned to other seasons vs unassigned ones
  const unassignedMemberships = availableMemberships.filter(m => !m.season_id)
  const otherSeasonMemberships = availableMemberships.filter(m => m.season_id && m.season_id !== season.id)

  const handleAssignMembership = async () => {
    if (!selectedMembershipId) return

    setLoading(true)
    setError('')

    try {
      const { error: updateError } = await supabase
        .from('memberships')
        .update({ season_id: season.id })
        .eq('id', selectedMembershipId)

      if (updateError) {
        setError(updateError.message)
      } else {
        router.push('/admin/seasons')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateNew = () => {
    router.push(`/admin/memberships/new?season_id=${season.id}`)
  }

  const handleSkip = () => {
    router.push('/admin/seasons')
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">
          {hasExistingMemberships ? 'Add Another Membership' : 'Membership Setup'}
        </h2>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Option 1: Assign Existing Membership */}
          <div className="border rounded-lg p-4">
            <label className="flex items-center">
              <input
                type="radio"
                name="action"
                value="assign"
                checked={selectedAction === 'assign'}
                onChange={(e) => setSelectedAction(e.target.value as 'assign')}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">
                Assign existing membership to this season
              </span>
            </label>
            
            {selectedAction === 'assign' && (
              <div className="mt-4 ml-7">
                {unassignedMemberships.length > 0 || otherSeasonMemberships.length > 0 ? (
                  <>
                    <select
                      value={selectedMembershipId}
                      onChange={(e) => setSelectedMembershipId(e.target.value)}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      <option value="">Select a membership</option>
                      {unassignedMemberships.length > 0 && (
                        <optgroup label="Available Memberships">
                          {unassignedMemberships.map((membership) => (
                            <option key={membership.id} value={membership.id}>
                              {membership.name} - ${(membership.price / 100).toFixed(2)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherSeasonMemberships.length > 0 && (
                        <optgroup label="Reassign from Other Seasons">
                          {otherSeasonMemberships.map((membership) => (
                            <option key={membership.id} value={membership.id}>
                              {membership.name} - ${(membership.price / 100).toFixed(2)} (currently assigned)
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <p className="mt-2 text-sm text-gray-500">
                      Choose an existing membership to assign to {season.name}
                    </p>
                    <button
                      onClick={handleAssignMembership}
                      disabled={!selectedMembershipId || loading}
                      className="mt-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {loading ? 'Assigning...' : 'Assign Membership'}
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">No existing memberships available to assign.</p>
                )}
              </div>
            )}
          </div>

          {/* Option 2: Create New Membership */}
          <div className="border rounded-lg p-4">
            <label className="flex items-center">
              <input
                type="radio"
                name="action"
                value="create"
                checked={selectedAction === 'create'}
                onChange={(e) => setSelectedAction(e.target.value as 'create')}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">
                Create new membership for this season
              </span>
            </label>
            
            {selectedAction === 'create' && (
              <div className="mt-4 ml-7">
                <p className="text-sm text-gray-500 mb-3">
                  Create a brand new membership specifically for {season.name}
                </p>
                <button
                  onClick={handleCreateNew}
                  className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Create New Membership
                </button>
              </div>
            )}
          </div>

          {/* Option 3: Skip for now */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Skip for now</p>
                <p className="text-sm text-gray-500">
                  You can set up memberships later when creating registrations
                </p>
              </div>
              <button
                onClick={handleSkip}
                className="inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}