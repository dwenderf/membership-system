'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getRegistrationStatus, getStatusDisplayText, getStatusBadgeStyle } from '@/lib/registration-status'

interface Registration {
  id: string
  name: string
  type: string
  is_active: boolean
  allow_discounts: boolean
  presale_code: string | null
  created_at: string
  seasons?: {
    name: string
  }
}

interface RegistrationsListProps {
  registrations: Registration[]
}

interface CollapsibleSectionProps {
  title: string
  count: number
  children: React.ReactNode
  defaultExpanded?: boolean
  badgeColor: string
}

function CollapsibleSection({ title, count, children, defaultExpanded = true, badgeColor }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded && count > 0)

  return (
    <div className="mb-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
            {count}
          </span>
        </div>
        <div className="flex items-center">
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
      
      {isExpanded && (
        <div className="mt-2">
          {count > 0 ? (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {children}
              </ul>
            </div>
          ) : (
            <div className="bg-white shadow sm:rounded-md p-6 text-center text-gray-500">
              No {title.toLowerCase()} registrations
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RegistrationItem({ registration }: { registration: Registration }) {
  const status = getRegistrationStatus(registration)
  
  return (
    <li>
      <div className="px-4 py-4 flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              <p className="text-lg font-medium text-gray-900 truncate">
                {registration.name}
              </p>
              <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
                registration.type === 'scrimmage' ? 'bg-green-100 text-green-800' :
                'bg-purple-100 text-purple-800'
              }`}>
                {registration.type}
              </span>
              <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                getStatusBadgeStyle(status)
              }`}>
                {getStatusDisplayText(status)}
              </span>
            </div>
            <div className="mt-1 flex items-center text-sm text-gray-500">
              <span>{registration.seasons?.name || 'No season'}</span>
              {!registration.allow_discounts && (
                <>
                  <span className="mx-2">•</span>
                  <span className="text-red-600">No Discounts</span>
                </>
              )}
              {registration.presale_code && (
                <>
                  <span className="mx-2">•</span>
                  <span className="text-purple-600">Pre-sale Code: {registration.presale_code}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href={`/admin/registrations/${registration.id}`}
            className="text-blue-600 hover:text-blue-500 text-sm font-medium"
          >
            Edit
          </Link>
        </div>
      </div>
    </li>
  )
}

export default function RegistrationsList({ registrations }: RegistrationsListProps) {
  // Group registrations by status
  const activeRegistrations = registrations.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'open' || status === 'presale'
  })
  
  const comingSoonRegistrations = registrations.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'coming_soon'
  })
  
  const draftRegistrations = registrations.filter(reg => !reg.is_active)
  
  const closedRegistrations = registrations.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'expired'
  })

  return (
    <div className="space-y-6">
      <CollapsibleSection
        title="Draft Registrations"
        count={draftRegistrations.length}
        badgeColor="bg-gray-100 text-gray-800"
        defaultExpanded={true}
      >
        {draftRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Active Registrations"
        count={activeRegistrations.length}
        badgeColor="bg-green-100 text-green-800"
        defaultExpanded={true}
      >
        {activeRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Coming Soon"
        count={comingSoonRegistrations.length}
        badgeColor="bg-yellow-100 text-yellow-800"
        defaultExpanded={true}
      >
        {comingSoonRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Closed Registrations"
        count={closedRegistrations.length}
        badgeColor="bg-red-100 text-red-800"
        defaultExpanded={false}
      >
        {closedRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} />
        ))}
      </CollapsibleSection>
    </div>
  )
}