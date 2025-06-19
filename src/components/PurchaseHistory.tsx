'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

interface UserMembership {
  id: string
  valid_from: string
  valid_until: string
  months_purchased: number
  payment_status: string
  amount_paid: number
  purchased_at: string
  membership?: {
    name: string
    description?: string
  }
}

interface PurchaseHistoryProps {
  userMemberships: UserMembership[]
}

export default function PurchaseHistory({ userMemberships }: PurchaseHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!userMemberships || userMemberships.length === 0) {
    return null
  }

  // Sort by purchase date (newest first)
  const sortedMemberships = [...userMemberships].sort((a, b) => {
    const dateA = new Date(a.purchased_at || a.valid_from)
    const dateB = new Date(b.purchased_at || b.valid_from)
    return dateB.getTime() - dateA.getTime()
  })

  return (
    <div className="mb-8">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center text-left text-lg font-medium text-gray-900 hover:text-gray-700 transition-colors"
      >
        <span>Purchase History</span>
        <span className="text-sm text-gray-500 ml-3 mr-2">
          {userMemberships.length} purchase{userMemberships.length !== 1 ? 's' : ''}
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
            {sortedMemberships.map((userMembership) => {
              const now = new Date()
              const validUntil = new Date(userMembership.valid_until)
              const isActive = validUntil > now && userMembership.payment_status === 'paid'
              const purchaseDate = new Date(userMembership.purchased_at || userMembership.valid_from)
              
              return (
                <li key={userMembership.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {userMembership.membership?.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            Purchased: {purchaseDate.toLocaleDateString()} at {purchaseDate.toLocaleTimeString()}
                          </p>
                        </div>
                        <div className="ml-3 flex-shrink-0">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            isActive
                              ? 'bg-green-100 text-green-800'
                              : userMembership.payment_status === 'paid' 
                              ? 'bg-gray-100 text-gray-800' 
                              : userMembership.payment_status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {isActive ? 'Active' : userMembership.payment_status === 'paid' ? 'Expired' : userMembership.payment_status}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-900 font-medium">
                        ${(userMembership.amount_paid / 100).toFixed(2)}
                      </div>
                    </div>
                    
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Duration:</span>
                        <span className="ml-1 text-gray-900">
                          {userMembership.months_purchased} month{userMembership.months_purchased !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Valid From:</span>
                        <span className="ml-1 text-gray-900">
                          {new Date(userMembership.valid_from).toLocaleDateString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Valid Until:</span>
                        <span className="ml-1 text-gray-900">
                          {new Date(userMembership.valid_until).toLocaleDateString()}
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