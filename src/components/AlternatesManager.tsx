'use client'

import { useState, useEffect } from 'react'
import { AlternatesAccessResult } from '@/lib/utils/alternates-access'
import RegistrationAlternatesSection from '@/components/RegistrationAlternatesSection'
import AllRegistrationsActivityGrid from '@/components/AllRegistrationsActivityGrid'

interface Registration {
  id: string
  name: string
  type: string
  allow_alternates: boolean
  alternate_price: number | null
  alternate_accounting_code: string | null
  is_active: boolean
  seasons: {
    id: string
    name: string
    end_date: string
  } | null
}

interface AlternatesManagerProps {
  registrations: Registration[]
  userAccess: AlternatesAccessResult
}

interface RegistrationWithGames extends Registration {
  games: Array<{
    id: string
    registrationId: string
    gameDescription: string
    gameDate: string | null
    createdAt: string
    selectedCount?: number
    availableCount?: number
  }>
}

export default function AlternatesManager({ registrations, userAccess }: AlternatesManagerProps) {
  const [selectedRegistration, setSelectedRegistration] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [registrationsWithGames, setRegistrationsWithGames] = useState<RegistrationWithGames[]>([])
  const [overviewLoading, setOverviewLoading] = useState(true)

  // Get the selected registration object
  const selectedRegistrationData = selectedRegistration 
    ? registrations.find(reg => reg.id === selectedRegistration)
    : null

  // Fetch games for all registrations for the overview
  useEffect(() => {
    fetchAllRegistrationsGames().catch(err => {
      console.error('Error in useEffect fetchAllRegistrationsGames:', err)
    })
  }, [registrations])

  const fetchAllRegistrationsGames = async () => {
    try {
      setOverviewLoading(true)
      
      // Fetch games for each registration
      const registrationsWithGamesData = await Promise.all(
        registrations.map(async (registration) => {
          try {
            const response = await fetch(`/api/alternate-registrations?registrationId=${registration.id}`)
            if (response.ok) {
              const data = await response.json()
              return {
                ...registration,
                games: data.games || []
              }
            } else {
              return {
                ...registration,
                games: []
              }
            }
          } catch (error) {
            console.error(`Error fetching games for ${registration.name}:`, error)
            return {
              ...registration,
              games: []
            }
          }
        })
      )
      
      setRegistrationsWithGames(registrationsWithGamesData)
    } catch (error) {
      console.error('Error fetching all registrations games:', error)
    } finally {
      setOverviewLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Registration Selection */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Select Registration</h2>
          <div className="flex items-center space-x-4">
            <select
              value={selectedRegistration}
              onChange={(e) => setSelectedRegistration(e.target.value)}
              className="block w-64 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="" disabled>Select Registration...</option>
              {registrations.map(reg => (
                <option key={reg.id} value={reg.id}>
                  {reg.name}
                  {reg.seasons && ` (${reg.seasons.name})`}
                </option>
              ))}
            </select>
            {selectedRegistrationData && (
              <span className="text-sm text-gray-500">
                {selectedRegistrationData.alternate_price 
                  ? `$${(selectedRegistrationData.alternate_price / 100).toFixed(2)} per alternate` 
                  : 'No alternate pricing set'
                }
              </span>
            )}
          </div>
        </div>
      </div>

      {/* All Registrations Overview */}
      {!overviewLoading && registrationsWithGames.length > 0 && (
        <AllRegistrationsActivityGrid
          registrations={registrationsWithGames}
          onRegistrationWeekClick={(registrationId, weekStart) => {
            // Auto-select the registration when user clicks on a week
            setSelectedRegistration(registrationId)
            console.log('Week clicked:', registrationId, weekStart)
          }}
        />
      )}

      {overviewLoading && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center text-gray-500">Loading overview...</div>
        </div>
      )}

      {/* Selected Registration Section */}
      {selectedRegistrationData ? (
        <RegistrationAlternatesSection
          registration={selectedRegistrationData}
          userAccess={userAccess}
        />
      ) : (
        <div className="bg-white shadow rounded-lg p-12 text-center">
          <div className="text-gray-500 text-lg mb-4">Select a Registration to Begin</div>
          <p className="text-sm text-gray-600 mb-4">
            Choose a registration from the dropdown above to view and manage its alternates.
          </p>
          <div className="flex items-center justify-center">
            <div className="text-sm text-gray-500">
              📋 {registrations.length} registration{registrations.length !== 1 ? 's' : ''} available
            </div>
          </div>
        </div>
      )}
    </div>
  )
}