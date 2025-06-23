'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

// Helper function to safely parse date strings without timezone conversion
function formatDateString(dateString: string): string {
  if (!dateString) return 'N/A'
  
  // Parse the date components manually to avoid timezone issues
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  
  return date.toLocaleDateString()
}

interface UserRegistration {
  id: string
  registration_id: string
  registered_at: string
  payment_status: string
  amount_paid: number
  registration?: {
    name: string
    type: string
    season?: {
      name: string
      start_date: string
      end_date: string
    }
  }
}

interface RegistrationHistoryProps {
  userRegistrations: UserRegistration[]
}

export default function RegistrationHistory({ userRegistrations }: RegistrationHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!userRegistrations || userRegistrations.length === 0) {
    return null
  }

  // Sort by registration date (newest first)
  const sortedRegistrations = [...userRegistrations].sort((a, b) => {
    const dateA = new Date(a.registered_at)
    const dateB = new Date(b.registered_at)
    return dateB.getTime() - dateA.getTime()
  })

  return (
    <div className="mb-8">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center text-left text-lg font-medium text-gray-900 hover:text-gray-700 transition-colors"
      >
        <span>Registration History</span>
        <span className="text-sm text-gray-500 ml-3 mr-2">
          {userRegistrations.length} registration{userRegistrations.length !== 1 ? 's' : ''}
        </span>
        {isExpanded ? (
          <ChevronUpIcon className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDownIcon className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-4 bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {sortedRegistrations.map((userRegistration) => {
              const now = new Date()
              const seasonEndDate = userRegistration.registration?.season?.end_date 
                ? new Date(userRegistration.registration.season.end_date)
                : null
              const isActive = seasonEndDate ? seasonEndDate > now : false
              const registrationDate = new Date(userRegistration.registered_at)
              
              return (
                <li key={userRegistration.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {userRegistration.registration?.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            Registered: {registrationDate.toLocaleDateString()} at {registrationDate.toLocaleTimeString()}
                          </p>
                        </div>
                        <div className="ml-3 flex-shrink-0">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            isActive && userRegistration.payment_status === 'paid'
                              ? 'bg-green-100 text-green-800'
                              : userRegistration.payment_status === 'paid' 
                              ? 'bg-gray-100 text-gray-800' 
                              : userRegistration.payment_status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {isActive && userRegistration.payment_status === 'paid' ? 'Active' : 
                             userRegistration.payment_status === 'paid' ? 'Completed' : userRegistration.payment_status}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-900 font-medium">
                        ${(userRegistration.amount_paid / 100).toFixed(2)}
                      </div>
                    </div>
                    
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Type:</span>
                        <span className="ml-1 text-gray-900">
                          {userRegistration.registration?.type || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Season:</span>
                        <span className="ml-1 text-gray-900">
                          {userRegistration.registration?.season?.name || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Season Dates:</span>
                        <span className="ml-1 text-gray-900">
                          {userRegistration.registration?.season?.start_date && userRegistration.registration?.season?.end_date
                            ? `${formatDateString(userRegistration.registration.season.start_date)} - ${formatDateString(userRegistration.registration.season.end_date)}`
                            : 'N/A'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}