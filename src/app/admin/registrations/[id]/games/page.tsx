'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import AlternateSelectionInterface from '@/components/AlternateSelectionInterface'

interface Game {
  id: string
  registrationId: string
  registrationName: string
  seasonName: string
  gameDescription: string
  gameDate: string
  alternatePrice: number
  alternateAccountingCode: string
  createdAt: string
  alternateSelections: number
}

interface Registration {
  id: string
  name: string
  allow_alternates: boolean
  alternate_price: number
  alternate_accounting_code: string
}

export default function RegistrationGamesPage() {
  const params = useParams()
  const registrationId = params.id as string

  const [registration, setRegistration] = useState<Registration | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [selectionResults, setSelectionResults] = useState<any>(null)

  const supabase = createClient()
  const { showError, showSuccess } = useToast()

  useEffect(() => {
    if (registrationId) {
      fetchRegistrationAndGames()
    }
  }, [registrationId])

  const fetchRegistrationAndGames = async () => {
    try {
      // Fetch registration details
      const { data: regData, error: regError } = await supabase
        .from('registrations')
        .select('id, name, allow_alternates, alternate_price, alternate_accounting_code')
        .eq('id', registrationId)
        .single()

      if (regError || !regData) {
        throw new Error('Registration not found')
      }

      setRegistration(regData)

      // Fetch games for this registration
      const response = await fetch(`/api/alternate-registrations?registration_id=${registrationId}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch games')
      }

      const gamesData = await response.json()
      setGames(gamesData.games)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectionComplete = (results: any) => {
    setSelectionResults(results)
    setSelectedGame(null)
    
    // Show appropriate toast notifications
    const { summary } = results
    if (summary.failedSelections > 0 && summary.successfulSelections === 0) {
      // All selections failed
      showError(`All ${summary.failedSelections} alternate selections failed. Check payment methods and try again.`)
    } else if (summary.failedSelections > 0) {
      // Some succeeded, some failed  
      showError(`${summary.failedSelections} of ${summary.totalProcessed} selections failed. ${summary.successfulSelections} were successful.`)
    } else {
      // All succeeded
      showSuccess(`Successfully selected ${summary.successfulSelections} alternates. Total charged: $${(summary.totalAmountCharged / 100).toFixed(2)}`)
    }
    
    // Refresh games to update selection counts
    fetchRegistrationAndGames()
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  // const formatDateTime = (dateString: string) => {
  //   return new Date(dateString).toLocaleString()
  // }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const isPastGame = (gameDate: string) => {
    return new Date(gameDate) <= new Date()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-red-600">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!registration) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-gray-500">Registration not found</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <Link
                  href={`/admin/registrations/${registrationId}`}
                  className="text-blue-600 hover:text-blue-500 text-sm font-medium"
                >
                  ← Back to Registration
                </Link>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">
                Games & Alternate Selection
              </h1>
              <p className="text-gray-600 mt-1">
                Registration: <span className="font-medium">{registration.name}</span>
              </p>
            </div>
          </div>

          {!registration.allow_alternates && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-yellow-800">
                This registration does not allow alternates. Enable alternates in the registration settings to create games.
              </p>
            </div>
          )}
        </div>

        {/* Selection Results */}
        {selectionResults && (() => {
          const { summary } = selectionResults
          const hasFailures = summary.failedSelections > 0
          const allFailed = summary.failedSelections > 0 && summary.successfulSelections === 0
          
          // Color scheme based on results
          const colorScheme = allFailed 
            ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', label: 'text-red-800', value: 'text-red-700', button: 'text-red-600 hover:text-red-800' }
            : hasFailures 
              ? { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-900', label: 'text-yellow-800', value: 'text-yellow-700', button: 'text-yellow-600 hover:text-yellow-800' }
              : { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-900', label: 'text-green-800', value: 'text-green-700', button: 'text-green-600 hover:text-green-800' }
          
          const title = allFailed ? 'Selection Failed' : hasFailures ? 'Selection Partially Complete' : 'Selection Complete'
          
          return (
            <div className={`mb-8 p-4 ${colorScheme.bg} border ${colorScheme.border} rounded-md`}>
              <h3 className={`text-lg font-medium ${colorScheme.text} mb-2`}>{title}</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className={`font-medium ${colorScheme.label}`}>Total Selected:</span>
                  <div className={colorScheme.value}>{summary.totalSelected}</div>
                </div>
                <div>
                  <span className={`font-medium ${colorScheme.label}`}>Successful:</span>
                  <div className={colorScheme.value}>{summary.successfulSelections}</div>
                </div>
                <div>
                  <span className={`font-medium ${colorScheme.label}`}>Failed:</span>
                  <div className={`${summary.failedSelections > 0 ? 'text-red-700 font-semibold' : colorScheme.value}`}>
                    {summary.failedSelections}
                  </div>
                </div>
                <div>
                  <span className={`font-medium ${colorScheme.label}`}>Total Charged:</span>
                  <div className={colorScheme.value}>{formatCurrency(summary.totalAmountCharged)}</div>
                </div>
              </div>
              <button
                onClick={() => setSelectionResults(null)}
                className={`mt-2 text-sm ${colorScheme.button}`}
              >
                Dismiss
              </button>
            </div>
          )
        })()}



        {/* Alternate Selection Interface */}
        {selectedGame && (
          <div className="mb-8">
            <AlternateSelectionInterface
              gameId={selectedGame.id}
              onSelectionComplete={handleSelectionComplete}
              onCancel={() => setSelectedGame(null)}
            />
          </div>
        )}

        {/* Games List */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Games ({games.length})
            </h3>

            {games.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No games created yet.</p>
                <p className="mt-2 text-sm">
                  Games can be created from the main registration page.
                </p>
                <Link
                  href={`/admin/registrations/${registrationId}`}
                  className="mt-3 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Go to Registration Page
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {games.map((game) => (
                  <div
                    key={game.id}
                    className={`border rounded-lg p-4 ${isPastGame(game.gameDate) ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300'
                      }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="text-lg font-medium text-gray-900">
                            {game.gameDescription}
                          </h4>
                          {isPastGame(game.gameDate) && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              Past Game
                            </span>
                          )}
                        </div>

                        <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
                          <div>
                            <span className="font-medium">Date:</span> {formatDate(game.gameDate)}
                          </div>
                          <div>
                            <span className="font-medium">Price:</span> {formatCurrency(game.alternatePrice)}
                          </div>
                          <div>
                            <span className="font-medium">Alternates Selected:</span> {game.alternateSelections}
                          </div>
                          <div>
                            <span className="font-medium">Created:</span> {formatDate(game.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div className="ml-4">
                        {!isPastGame(game.gameDate) && !selectedGame && (
                          <button
                            onClick={() => setSelectedGame(game)}
                            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                          >
                            Select Alternates
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}