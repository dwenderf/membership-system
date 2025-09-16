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
  const [selectedRegistration, setSelectedRegistration] = useState<string>('all')
  const [loading, setLoading] = useState(false)

  // Filter registrations based on selection
  const filteredRegistrations = selectedRegistration === 'all' 
    ? registrations 
    : registrations.filter(reg => reg.id === selectedRegistration)

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Filter by Registration</h2>
          <div className="flex items-center space-x-4">
            <select
              value={selectedRegistration}
              onChange={(e) => setSelectedRegistration(e.target.value)}
              className="block w-64 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="all">All Registrations</option>
              {registrations.map(reg => (
                <option key={reg.id} value={reg.id}>
                  {reg.name} ({reg.type})
                </option>
              ))}
            </select>
            <span className="text-sm text-gray-500">
              {filteredRegistrations.length} registration{filteredRegistrations.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Registration Sections */}
      <div className="space-y-6">
        {filteredRegistrations.map(registration => (
          <RegistrationAlternatesSection
            key={registration.id}
            registration={registration}
            userAccess={userAccess}
          />
        ))}
      </div>

      {filteredRegistrations.length === 0 && selectedRegistration !== 'all' && (
        <div className="bg-white shadow rounded-lg p-12 text-center">
          <div className="text-gray-500 text-lg mb-4">No Registration Found</div>
          <p className="text-sm text-gray-600">
            The selected registration may have been removed or disabled.
          </p>
        </div>
      )}
    </div>
  )
}