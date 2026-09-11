'use client'

import { ReactNode, useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface WaitlistRemoveButtonProps {
  waitlistId: string
  label?: string
  confirmTitle: string
  confirmMessage: ReactNode
  onRemoved?: () => void
  className?: string
}

/**
 * Removes a waitlist entry via DELETE /api/waitlists/[waitlistId].
 * Shared by the member's own "Leave Waitlist" action and the captain/admin
 * "Remove" action on roster pages — the API authorizes all three the same way.
 */
export default function WaitlistRemoveButton({
  waitlistId,
  label = 'Leave Waitlist',
  confirmTitle,
  confirmMessage,
  onRemoved,
  className,
}: WaitlistRemoveButtonProps) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/waitlists/${waitlistId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove from waitlist')
      }

      setDialogOpen(false)
      if (onRemoved) {
        onRemoved()
      } else {
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from waitlist')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={className ?? 'inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'}
      >
        {label}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <ConfirmationDialog
        isOpen={dialogOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={label}
        onConfirm={handleConfirm}
        onCancel={() => setDialogOpen(false)}
        isLoading={isLoading}
        variant="warning"
      />
    </>
  )
}
