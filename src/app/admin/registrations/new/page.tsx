'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatDateString } from '@/lib/date-utils'
import Link from 'next/link'

export default function NewRegistrationPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [formData, setFormData] = useState({
    season_id: '',
    required_membership_id: '',
    name: '',
    type: 'team' as 'team' | 'scrimmage' | 'event',
    allow_discounts: true,
  })
  
  const [seasons, setSeasons] = useState<any[]>([])
  const [memberships, setMemberships] = useState<any[]>([])
  const [existingRegistrations, setExistingRegistrations] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch available seasons, memberships, and existing registrations
  useEffect(() => {
    const fetchData = async () => {
      // Fetch seasons
      const { data: seasonsData, error: seasonsError } = await supabase
        .from('seasons')
        .select('*')
        .order('start_date', { ascending: false })
      
      if (!seasonsError && seasonsData) {
        setSeasons(seasonsData)
      }

      // Fetch existing registrations to check for duplicates
      const { data: registrationsData, error: registrationsError } = await supabase
        .from('registrations')
        .select('name')
      
      if (!registrationsError && registrationsData) {
        setExistingRegistrations(registrationsData)
      }
    }
    
    fetchData()
  }, [])

  // Fetch memberships when season changes
  useEffect(() => {
    const fetchMemberships = async () => {
      if (formData.season_id) {
        const { data: membershipsData, error: membershipsError } = await supabase
          .from('memberships')
          .select('*')
          .eq('season_id', formData.season_id)
          .order('name')
        
        if (!membershipsError && membershipsData) {
          setMemberships(membershipsData)
        } else {
          setMemberships([])
        }
      } else {
        setMemberships([])
      }
    }
    
    fetchMemberships()
  }, [formData.season_id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canCreateRegistration) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      const registrationData = {
        season_id: formData.season_id,
        required_membership_id: formData.required_membership_id || null,
        name: formData.name,
        type: formData.type,
        allow_discounts: formData.allow_discounts,
      }

      const { error: insertError } = await supabase
        .from('registrations')
        .insert([registrationData])

      if (insertError) {
        setError(insertError.message)
      } else {
        // Redirect to the registration detail page to add categories
        const { data: newRegistration } = await supabase
          .from('registrations')
          .select('id')
          .eq('name', formData.name)
          .single()
        
        if (newRegistration) {
          router.push(`/admin/registrations/${newRegistration.id}`)
        } else {
          router.push('/admin/registrations')
        }
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const selectedSeason = seasons.find(s => s.id === formData.season_id)
  const selectedMembership = memberships.find(m => m.id === formData.required_membership_id)
  
  // Check for duplicate registration name
  const registrationNameExists = existingRegistrations.some(registration => 
    registration.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  
  const canCreateRegistration = formData.season_id && 
                               formData.name.trim() && 
                               !registrationNameExists

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Create New Registration</h1>
            <p className="mt-1 text-sm text-gray-600">
              Set up a team registration or event for a specific season
            </p>
          </div>

          {/* Form */}
          <div className="bg-white shadow rounded-lg">
            <form onSubmit={handleSubmit} className="space-y-6 p-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
                  {error}
                </div>
              )}

              {/* Season Selection */}
              <div>
                <label htmlFor="season_id" className="block text-sm font-medium text-gray-700">
                  Season
                </label>
                <select
                  id="season_id"
                  value={formData.season_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, season_id: e.target.value, required_membership_id: '' }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  required
                >
                  <option value="">Select a season</option>
                  {seasons.map((season) => {
                    const isEnded = new Date(season.end_date) < new Date()
                    return (
                      <option key={season.id} value={season.id}>
                        {season.name} {isEnded ? '(Ended)' : ''}
                      </option>
                    )
                  })}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  Choose which season this registration is for
                </p>
              </div>

              {/* Registration Type */}
              <div>
                <label htmlFor="type" className="block text-sm font-medium text-gray-700">
                  Registration Type
                </label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as 'team' | 'scrimmage' | 'event' }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  required
                >
                  <option value="team">Team</option>
                  <option value="scrimmage">Scrimmage</option>
                  <option value="event">Event</option>
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  Type of registration (team, scrimmage, or event)
                </p>
              </div>

              {/* Registration Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Registration Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., Rec League Team A, Friday Night Scrimmage"
                  required
                />
              </div>

              {/* Duplicate Name Warning */}
              {registrationNameExists && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                      <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                        <li>A registration with the name "{formData.name}" already exists</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Required Membership */}
              <div>
                <label htmlFor="required_membership_id" className="block text-sm font-medium text-gray-700">
                  Required Membership
                </label>
                <select
                  id="required_membership_id"
                  value={formData.required_membership_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, required_membership_id: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  disabled={!formData.season_id}
                >
                  <option value="">No membership required (free registration)</option>
                  {memberships.map((membership) => (
                    <option key={membership.id} value={membership.id}>
                      {membership.name} - ${(membership.price / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  {!formData.season_id ? 'Select a season first to see available memberships' : 'Optional: Choose a membership that users must have to register'}
                </p>
              </div>

              {/* Categories Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-800">About Categories</h3>
                    <div className="mt-2 text-sm text-blue-700">
                      <p>After creating this registration, you'll be able to add participant categories (e.g., Players, Goalies, Alternates) with individual capacity limits and accounting codes.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Allow Discounts */}
              <div className="flex items-center">
                <input
                  id="allow_discounts"
                  type="checkbox"
                  checked={formData.allow_discounts}
                  onChange={(e) => setFormData(prev => ({ ...prev, allow_discounts: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="allow_discounts" className="ml-2 block text-sm text-gray-900">
                  Allow discount codes to be applied to this registration
                </label>
              </div>

              {/* Preview */}
              {selectedSeason && (
                <div className={`border rounded-md p-4 ${registrationNameExists ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Registration Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Season</dt>
                      <dd className="text-sm text-gray-900">{selectedSeason.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Type</dt>
                      <dd className="text-sm text-gray-900 capitalize">{formData.type}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Capacity</dt>
                      <dd className="text-sm text-gray-900">
                        Set per category
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Required Membership</dt>
                      <dd className="text-sm text-gray-900">
                        {selectedMembership ? selectedMembership.name : 'None (free registration)'}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <Link
                  href="/admin/registrations"
                  className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={loading || !canCreateRegistration}
                  className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateRegistration && !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
{loading ? 'Creating...' : canCreateRegistration ? 'Create Registration & Add Categories' : 'Complete Form to Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}