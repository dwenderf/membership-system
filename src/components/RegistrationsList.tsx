'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getRegistrationStatus, getStatusDisplayText, getStatusBadgeStyle, type RegistrationWithTiming } from '@/lib/registration-status'
import RegistrationTypeBadge from '@/components/RegistrationTypeBadge'
import { formatEventDateTime } from '@/lib/date-utils'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface Registration extends RegistrationWithTiming {
  name: string
  published_at: string | null
  allow_discounts: boolean
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

function RegistrationItem({
  registration,
  onDeleteClick
}: {
  registration: Registration
  onDeleteClick: (id: string, name: string) => void
}) {
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
              <RegistrationTypeBadge type={registration.type as 'team' | 'scrimmage' | 'event' | 'tournament'} className="ml-2" />
              <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                getStatusBadgeStyle(status)
              }`}>
                {getStatusDisplayText(status)}
              </span>
            </div>
            <div className="mt-1 flex items-center text-sm text-gray-500">
              {(registration.type === 'event' || registration.type === 'scrimmage') && registration.start_date ? (
                <span>{formatEventDateTime(registration.start_date)}</span>
              ) : (
                <span>{registration.seasons?.name || 'No season'}</span>
              )}
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
          {!registration.published_at && (
            <button
              onClick={() => onDeleteClick(registration.id, registration.name)}
              className="text-red-600 hover:text-red-500 text-sm font-medium"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export default function RegistrationsList({ registrations }: RegistrationsListProps) {
  const [regs, setRegs] = useState(registrations)
  const [registrationToDelete, setRegistrationToDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Group registrations by status
  const activeRegistrations = regs.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'open' || status === 'presale'
  })

  const comingSoonRegistrations = regs.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'coming_soon'
  })

  const draftRegistrations = regs.filter(reg => !reg.is_active)

  const closedRegistrations = regs.filter(reg => {
    const status = getRegistrationStatus(reg)
    return status === 'expired' || status === 'past'
  })

  const handleDeleteClick = (id: string, name: string) => {
    setDeleteError(null)
    setRegistrationToDelete({ id, name })
    setDeleteDialogOpen(true)
  }

  const handleCancelDelete = () => {
    setDeleteDialogOpen(false)
    setRegistrationToDelete(null)
  }

  const handleConfirmDelete = async () => {
    if (!registrationToDelete) return

    try {
      setDeleting(true)
      setDeleteError(null)

      const response = await fetch(`/api/admin/registrations/${registrationToDelete.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete registration')
      }

      setRegs(prev => prev.filter(r => r.id !== registrationToDelete.id))
      setDeleteDialogOpen(false)
      setRegistrationToDelete(null)
    } catch (err) {
      console.error('Error deleting registration:', err)
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete registration')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <CollapsibleSection
        title="Draft Registrations"
        count={draftRegistrations.length}
        badgeColor="bg-gray-100 text-gray-800"
        defaultExpanded={true}
      >
        {draftRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} onDeleteClick={handleDeleteClick} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Active Registrations"
        count={activeRegistrations.length}
        badgeColor="bg-green-100 text-green-800"
        defaultExpanded={true}
      >
        {activeRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} onDeleteClick={handleDeleteClick} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Coming Soon"
        count={comingSoonRegistrations.length}
        badgeColor="bg-yellow-100 text-yellow-800"
        defaultExpanded={true}
      >
        {comingSoonRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} onDeleteClick={handleDeleteClick} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Closed Registrations"
        count={closedRegistrations.length}
        badgeColor="bg-red-100 text-red-800"
        defaultExpanded={false}
      >
        {closedRegistrations.map(registration => (
          <RegistrationItem key={registration.id} registration={registration} onDeleteClick={handleDeleteClick} />
        ))}
      </CollapsibleSection>

      <ConfirmationDialog
        isOpen={deleteDialogOpen}
        title="Delete Registration"
        message={
          <div>
            <p>Are you sure you want to delete <strong>{registrationToDelete?.name}</strong>?</p>
            <p className="mt-2 text-sm text-gray-600">This will permanently delete the registration and all its categories. This cannot be undone.</p>
            {deleteError && (
              <p className="mt-2 text-sm text-red-600">{deleteError}</p>
            )}
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isLoading={deleting}
        variant="danger"
      />
    </div>
  )
}