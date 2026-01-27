'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { convertToNYTimezone } from '@/lib/date-utils'
import Link from 'next/link'
import EventDateTimeInput from '@/components/EventDateTimeInput'
import AccountingCodeInput from '@/components/admin/AccountingCodeInput'

export default function NewRegistrationPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [formData, setFormData] = useState({
    season_id: '',
    name: '',
    type: 'team' as 'team' | 'scrimmage' | 'event' | 'tournament',
    allow_discounts: true,
    allow_alternates: false,
    alternate_price: '',
    alternate_accounting_code: '',
    start_date: '',
    duration_minutes: '', // Duration in minutes instead of end_date
    required_membership_id: '', // Optional registration-level membership requirement
    require_survey: false,
    survey_id: '',
  })

  const [seasons, setSeasons] = useState<any[]>([])
  const [existingRegistrations, setExistingRegistrations] = useState<any[]>([])
  const [availableMemberships, setAvailableMemberships] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountingCodesValid, setAccountingCodesValid] = useState<boolean | null>(null)
  const [accountingCodesError, setAccountingCodesError] = useState('')

  // Fetch available seasons and existing registrations
  useEffect(() => {
    const fetchData = async () => {
      // First validate accounting codes
      try {
        const response = await fetch('/api/validate-accounting-codes')
        if (response.ok) {
          const validation = await response.json()
          setAccountingCodesValid(validation.isValid)
          if (!validation.isValid) {
            setAccountingCodesError(validation.message)
          }
        } else {
          setAccountingCodesValid(false)
          setAccountingCodesError('Failed to validate accounting codes')
        }
      } catch (error) {
        setAccountingCodesValid(false)
        setAccountingCodesError('Failed to validate accounting codes')
      }

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

      // Fetch available memberships
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('memberships')
        .select('id, name, price_monthly, price_annual')
        .order('name')

      if (!membershipsError && membershipsData) {
        setAvailableMemberships(membershipsData)
      }
    }

    fetchData()
  }, [])

  // Removed season membership fetching - no longer needed


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canCreateRegistration) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      // Calculate end_date from start_date + duration
      let startDateUTC = null
      let endDateUTC = null

      if ((formData.type === 'event' || formData.type === 'scrimmage' || formData.type === 'tournament') && formData.start_date && formData.duration_minutes) {
        // For tournaments, the date picker returns just a date (YYYY-MM-DD) without time
        // We need to append midnight time for proper timezone conversion
        let dateTimeString = formData.start_date
        if (formData.type === 'tournament' && !formData.start_date.includes('T')) {
          dateTimeString = formData.start_date + 'T00:00'
        }

        startDateUTC = convertToNYTimezone(dateTimeString)

        // Calculate end date by adding duration to start date
        const startDate = new Date(startDateUTC)

        if (formData.type === 'tournament') {
          // For tournaments, ensure we end at the last minute of the final day
          // Duration is in minutes (days * 1440), but we want the end to be 23:59:59
          const durationMs = parseInt(formData.duration_minutes) * 60 * 1000
          const endDate = new Date(startDate.getTime() + durationMs - 1000) // Subtract 1 second to end at 23:59:59
          endDateUTC = endDate.toISOString()
        } else {
          // For events and scrimmages, add the exact duration
          const endDate = new Date(startDate.getTime() + parseInt(formData.duration_minutes) * 60 * 1000)
          endDateUTC = endDate.toISOString()
        }
      }

      const registrationData = {
        season_id: formData.season_id,
        name: formData.name,
        type: formData.type,
        allow_discounts: formData.allow_discounts,
        allow_alternates: formData.allow_alternates,
        alternate_price: formData.allow_alternates ? parseInt(formData.alternate_price) * 100 : null, // Convert to cents
        alternate_accounting_code: formData.allow_alternates ? formData.alternate_accounting_code : null,
        start_date: startDateUTC,
        end_date: endDateUTC,
        required_membership_id: formData.required_membership_id || null,
        require_survey: formData.require_survey,
        survey_id: formData.require_survey ? formData.survey_id : null,
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
  
  // Check for duplicate registration name
  const registrationNameExists = existingRegistrations.some(registration => 
    registration.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  
  const requiresDates = formData.type === 'event' || formData.type === 'scrimmage' || formData.type === 'tournament'

  // Set default duration when type changes
  const getDefaultDuration = (type: string) => {
    if (type === 'scrimmage') return '90' // 90 minutes
    if (type === 'event') return '180' // 3 hours
    if (type === 'tournament') return '4320' // 3 days (3 * 24 * 60 = 4320 minutes)
    return ''
  }

  const canCreateRegistration = formData.season_id &&
                               formData.name.trim() &&
                               !registrationNameExists &&
                               accountingCodesValid === true &&
                               (!formData.allow_alternates || (
                                 formData.alternate_price.trim() &&
                                 parseFloat(formData.alternate_price) > 0 &&
                                 formData.alternate_accounting_code.trim()
                               )) &&
                               (!requiresDates || (formData.start_date && formData.duration_minutes)) &&
                               (!formData.require_survey || formData.survey_id.trim())

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

          {/* Accounting codes validation */}
          {accountingCodesValid === false && (
            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">
                    Accounting Codes Required
                  </h3>
                  <div className="mt-2 text-sm text-yellow-700">
                    <p>{accountingCodesError}</p>
                  </div>
                  <div className="mt-4">
                    <Link
                      href="/admin/accounting-codes"
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-yellow-800 bg-yellow-50 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                    >
                      Configure Accounting Codes
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

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
                  onChange={(e) => setFormData(prev => ({ ...prev, season_id: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  required
                >
                  <option value="">Please select a season</option>
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

              {/* Removed membership warning - no longer season-specific */}

              {/* Required Membership (Optional) */}
              <div>
                <label htmlFor="required_membership_id" className="block text-sm font-medium text-gray-700">
                  Required Membership (Optional)
                </label>
                <select
                  id="required_membership_id"
                  value={formData.required_membership_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, required_membership_id: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="">No registration-level requirement</option>
                  {availableMemberships.map((membership) => (
                    <option key={membership.id} value={membership.id}>
                      {membership.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  Optional default membership requirement. Categories can offer alternative memberships.
                  Users need EITHER this membership OR a category-specific membership to register.
                </p>
              </div>

              {/* Survey Configuration */}
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    id="require_survey"
                    type="checkbox"
                    checked={formData.require_survey}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      require_survey: e.target.checked,
                      // Clear survey_id if unchecked
                      survey_id: e.target.checked ? prev.survey_id : ''
                    }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="require_survey" className="ml-2 block text-sm text-gray-900">
                    Require survey completion before payment
                  </label>
                </div>

                {formData.require_survey && (
                  <div className="ml-6 space-y-2 p-4 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="text-sm text-blue-800 mb-3">
                      <strong>Survey Integration:</strong> Enter your Formbricks survey ID. Users will complete this survey before proceeding to payment.
                    </div>

                    <div>
                      <label htmlFor="survey_id" className="block text-sm font-medium text-gray-700">
                        Survey ID
                      </label>
                      <input
                        type="text"
                        id="survey_id"
                        value={formData.survey_id}
                        onChange={(e) => setFormData(prev => ({ ...prev, survey_id: e.target.value }))}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        placeholder="e.g., cmkvdmu2804u4ad01o4ve1lj1"
                        required={formData.require_survey}
                      />
                      <p className="mt-1 text-sm text-gray-500">
                        The unique identifier for your Formbricks survey
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Registration Type */}
              <div>
                <label htmlFor="type" className="block text-sm font-medium text-gray-700">
                  Registration Type
                </label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={(e) => {
                    const newType = e.target.value as 'team' | 'scrimmage' | 'event' | 'tournament'
                    setFormData(prev => ({
                      ...prev,
                      type: newType,
                      duration_minutes: getDefaultDuration(newType)
                    }))
                  }}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  required
                >
                  <option value="team">Team</option>
                  <option value="scrimmage">Scrimmage</option>
                  <option value="event">Event</option>
                  <option value="tournament">Tournament</option>
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  Type of registration (team, scrimmage, event, or tournament)
                </p>
              </div>

              {/* Event/Scrimmage/Tournament Date Fields - Only shown for events, scrimmages, and tournaments */}
              {requiresDates && (
                <EventDateTimeInput
                  startDate={formData.start_date}
                  durationMinutes={formData.duration_minutes}
                  onStartDateChange={(value) => setFormData(prev => ({ ...prev, start_date: value }))}
                  onDurationChange={(value) => setFormData(prev => ({ ...prev, duration_minutes: value }))}
                  registrationType={formData.type as 'event' | 'scrimmage' | 'tournament'}
                  required={requiresDates}
                />
              )}

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
                      <p>After creating this registration, you'll be able to add participant categories (e.g., Players, Goalies, Alternates) with individual capacity limits, membership requirements, and accounting codes.</p>
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

              {/* Allow Alternates */}
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    id="allow_alternates"
                    type="checkbox"
                    checked={formData.allow_alternates}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      allow_alternates: e.target.checked,
                      // Clear alternate fields if unchecked
                      alternate_price: e.target.checked ? prev.alternate_price : '',
                      alternate_accounting_code: e.target.checked ? prev.alternate_accounting_code : ''
                    }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="allow_alternates" className="ml-2 block text-sm text-gray-900">
                    Allow alternates for this registration
                  </label>
                </div>

                {formData.allow_alternates && (
                  <div className="ml-6 space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="text-sm text-blue-800 mb-3">
                      <strong>Alternate Configuration:</strong> Set the price and accounting code for alternate selections.
                    </div>
                    
                    {/* Alternate Price */}
                    <div>
                      <label htmlFor="alternate_price" className="block text-sm font-medium text-gray-700">
                        Alternate Price (USD)
                      </label>
                      <div className="mt-1 relative rounded-md shadow-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500 sm:text-sm">$</span>
                        </div>
                        <input
                          type="number"
                          id="alternate_price"
                          value={formData.alternate_price}
                          onChange={(e) => setFormData(prev => ({ ...prev, alternate_price: e.target.value }))}
                          className="block w-full pl-7 pr-12 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          required={formData.allow_alternates}
                        />
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        Price charged when an alternate is selected for a game
                      </p>
                    </div>

                    {/* Alternate Accounting Code */}
                    <div>
                      <AccountingCodeInput
                        value={formData.alternate_accounting_code}
                        onChange={(value) => setFormData(prev => ({ ...prev, alternate_accounting_code: value }))}
                        label="Alternate Accounting Code"
                        required={formData.allow_alternates}
                        placeholder="Search by code or name..."
                        suggestedAccountType="REVENUE"
                      />
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Accounting code used for alternate charges in Xero
                      </p>
                    </div>
                  </div>
                )}
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
                        {formData.required_membership_id ? (
                          availableMemberships.find(m => m.id === formData.required_membership_id)?.name || 'Unknown'
                        ) : (
                          'None (optional)'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Category Requirements</dt>
                      <dd className="text-sm text-gray-900">
                        Set per category
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Survey</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.require_survey ? (
                          <div className="space-y-1">
                            <div>Required</div>
                            {formData.survey_id && (
                              <div className="text-xs text-gray-600 font-mono">
                                ID: {formData.survey_id}
                              </div>
                            )}
                          </div>
                        ) : (
                          'Not required'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Alternates</dt>
                      <dd className="text-sm text-gray-900">
                        {formData.allow_alternates ? (
                          <div className="space-y-1">
                            <div>Enabled</div>
                            {formData.alternate_price && (
                              <div className="text-xs text-gray-600">
                                Price: ${parseFloat(formData.alternate_price).toFixed(2)}
                              </div>
                            )}
                            {formData.alternate_accounting_code && (
                              <div className="text-xs text-gray-600">
                                Code: {formData.alternate_accounting_code}
                              </div>
                            )}
                          </div>
                        ) : (
                          'Disabled'
                        )}
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
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateRegistration && !loading
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
                  {loading ? 'Creating Registration...' : canCreateRegistration ? 'Create Registration & Add Categories' : 'Complete Form to Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}