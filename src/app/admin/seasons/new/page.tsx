'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SEASON_TYPES, calculateSeasonDates, generateSeasonName, getSeasonTypeByKey } from '@/lib/season-types'
import Link from 'next/link'
import { formatDate } from '@/lib/date-utils'

export default function NewSeasonPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [formData, setFormData] = useState({
    type: '' as '' | 'fall_winter' | 'spring_summer',
    start_year: new Date().getFullYear(),
    is_active: true,
  })
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [existingSeasons, setExistingSeasons] = useState<any[]>([])

  // Calculate derived values only if type is selected
  const seasonType = formData.type ? getSeasonTypeByKey(formData.type) : null
  const { startDate, endDate } = seasonType ? calculateSeasonDates(seasonType, formData.start_year) : { startDate: new Date(), endDate: new Date() }
  const seasonName = seasonType ? generateSeasonName(seasonType, formData.start_year) : ''

  // Check validations
  const isEndDateInPast = seasonType ? endDate < new Date() : false
  const seasonExists = formData.type ? existingSeasons.some(season => 
    season.type === formData.type && new Date(season.start_date).getFullYear() === formData.start_year
  ) : false
  const canCreateSeason = formData.type && !isEndDateInPast && !seasonExists

  // Fetch existing seasons to check for duplicates
  useEffect(() => {
    const fetchSeasons = async () => {
      const { data, error } = await supabase
        .from('seasons')
        .select('type, start_date, name')
      
      if (!error && data) {
        setExistingSeasons(data)
      }
    }
    
    fetchSeasons()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canCreateSeason) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      const seasonData = {
        name: seasonName,
        type: formData.type,
        start_date: startDate.toISOString().split('T')[0], // YYYY-MM-DD format
        end_date: endDate.toISOString().split('T')[0],
        is_active: formData.is_active,
      }

      const { error: insertError } = await supabase
        .from('seasons')
        .insert([seasonData])

      if (insertError) {
        setError(insertError.message)
      } else {
        router.push('/admin/seasons')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Create New Season</h1>
            <p className="mt-1 text-sm text-gray-600">
              Set up a new hockey season for your association
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

              {/* Season Type */}
              <div>
                <label htmlFor="type" className="block text-sm font-medium text-gray-700">
                  Season Type
                </label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as '' | 'fall_winter' | 'spring_summer' }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  required
                >
                  <option value="">Please select a season type</option>
                  {SEASON_TYPES.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.name} - {type.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Season Start Year */}
              <div>
                <label htmlFor="start_year" className="block text-sm font-medium text-gray-700">
                  Season Start Year
                </label>
                <input
                  type="number"
                  id="start_year"
                  value={formData.start_year}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_year: parseInt(e.target.value) }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  min="2020"
                  max="2030"
                />
                <p className="mt-1 text-sm text-gray-500">
                  The year when this season starts
                </p>
              </div>

              {/* Validation Warnings */}
              {(isEndDateInPast || seasonExists) && (
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
                        {isEndDateInPast && (
                          <li>This season would end in the past ({formatDate(endDate)})</li>
                        )}
                        {seasonExists && (
                          <li>A {seasonType?.name?.toLowerCase()} season for {formData.start_year} already exists</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Season Preview */}
              <div className={`border rounded-md p-4 ${canCreateSeason ? 'bg-gray-50 border-gray-200' : 'bg-red-50 border-red-200'}`}>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Season Preview</h4>
                {formData.type ? (
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Season Name</dt>
                      <dd className="text-sm text-gray-900">{seasonName}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Type</dt>
                      <dd className="text-sm text-gray-900">{seasonType?.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Start Date</dt>
                      <dd className="text-sm text-gray-900">{formatDate(startDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">End Date</dt>
                      <dd className="text-sm text-gray-900">{formatDate(endDate)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">Please select a season type to see preview</p>
                )}
              </div>

              {/* Is Active */}
              <div className="flex items-center">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                  Active Season
                </label>
                <p className="ml-2 text-sm text-gray-500">
                  (Can be changed later)
                </p>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <Link
                  href="/admin/seasons"
                  className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={loading || !canCreateSeason}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateSeason && !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {loading && (
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {loading ? 'Creating Season...' : canCreateSeason ? 'Create Season' : 'Complete Form to Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}