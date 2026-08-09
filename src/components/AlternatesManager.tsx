'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlternatesAccessResult } from '@/lib/utils/alternates-access'
import RegistrationAlternatesSection from '@/components/RegistrationAlternatesSection'
import AllRegistrationsActivityGrid from '@/components/AllRegistrationsActivityGrid'
import SeasonSelector from '@/components/SeasonSelector'
import { getDefaultSeasonId, SeasonSummary } from '@/lib/utils/season-utils'

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
    start_date: string
    end_date: string
  } | null
}

interface AlternatesManagerProps {
  registrations: Registration[]
  seasons: { id: string, name: string, start_date: string, end_date: string }[]
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

export default function AlternatesManager({ registrations, seasons: rawSeasons, userAccess }: AlternatesManagerProps) {
  const seasons = useMemo<SeasonSummary[]>(
    () => rawSeasons.map(s => ({ id: s.id, name: s.name, startDate: s.start_date, endDate: s.end_date })),
    [rawSeasons]
  )
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(() => getDefaultSeasonId(seasons) ?? '')
  const [selectedRegistration, setSelectedRegistration] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [registrationsWithGames, setRegistrationsWithGames] = useState<RegistrationWithGames[]>([])
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const selectedSeason = seasons.find(season => season.id === selectedSeasonId) || null

  const registrationsForSeason = useMemo(
    () => registrations.filter(registration => registration.seasons?.id === selectedSeasonId),
    [registrations, selectedSeasonId]
  )

  const handleSeasonSelect = (seasonId: string) => {
    setSelectedSeasonId(seasonId)
    setSelectedRegistration('')
  }

  // Get the selected registration object
  const selectedRegistrationData = selectedRegistration
    ? registrationsForSeason.find(reg => reg.id === selectedRegistration)
    : null

  // Fetch games for the current season's registrations for the overview
  useEffect(() => {
    fetchRegistrationsGames().catch(err => {
      console.error('Error in useEffect fetchRegistrationsGames:', err)
    })
  }, [registrationsForSeason])

  const fetchRegistrationsGames = async () => {
    try {
      setOverviewLoading(true)
      setOverviewError(null)

      if (registrationsForSeason.length === 0) {
        setRegistrationsWithGames([])
        return
      }

      // Fetch games for all of this season's registrations in a single batched request
      const registrationIds = registrationsForSeason.map(r => encodeURIComponent(r.id)).join(',')
      const response = await fetch(`/api/alternate-registrations/batch?registrationIds=${registrationIds}`)

      if (!response.ok) {
        throw new Error(`Batch request failed with status ${response.status}`)
      }

      const data = await response.json()
      const gamesByRegistration: Record<string, RegistrationWithGames['games']> = data.games || {}

      const registrationsWithGamesData = registrationsForSeason.map(registration => ({
        ...registration,
        games: gamesByRegistration[registration.id] || []
      }))

      setRegistrationsWithGames(registrationsWithGamesData)
    } catch (error) {
      console.error('Error fetching registrations games:', error)
      setRegistrationsWithGames([])
      setOverviewError('Couldn\'t load the activity overview. Please try refreshing the page.')
    } finally {
      setOverviewLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Season Selection */}
      {seasons.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-lg font-medium text-gray-900">Select Season</h2>
            <SeasonSelector
              seasons={seasons}
              selectedSeasonId={selectedSeasonId}
              onSelect={handleSeasonSelect}
            />
          </div>
        </div>
      )}

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
              {registrationsForSeason.map(reg => (
                <option key={reg.id} value={reg.id}>
                  {reg.name}
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

      {/* Season Registrations Overview */}
      {!overviewLoading && overviewError && (
        <div className="bg-red-50 border border-red-200 shadow rounded-lg p-6">
          <div className="text-center text-red-700 text-sm">{overviewError}</div>
        </div>
      )}

      {!overviewLoading && !overviewError && selectedSeason && registrationsWithGames.length > 0 && (
        <AllRegistrationsActivityGrid
          registrations={registrationsWithGames}
          seasonStart={selectedSeason.startDate}
          seasonEnd={selectedSeason.endDate}
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
              📋 {registrationsForSeason.length} registration{registrationsForSeason.length !== 1 ? 's' : ''} available
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
