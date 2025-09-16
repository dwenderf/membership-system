'use client'

import { useState, useEffect } from 'react'
import { AlternatesAccessResult } from '@/lib/utils/alternates-access'
import RegistrationAlternatesSection from '@/components/RegistrationAlternatesSection'

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

export default function AlternatesManager({ registrations, userAccess }: AlternatesManagerProps) {
  const [selectedRegistration, setSelectedRegistration] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Get the selected registration object
  const selectedRegistrationData = selectedRegistration 
    ? registrations.find(reg => reg.id === selectedRegistration)
    : null

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