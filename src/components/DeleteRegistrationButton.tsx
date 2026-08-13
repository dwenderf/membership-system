'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface DeleteRegistrationButtonProps {
  registrationId: string
  registrationName: string
}

export default function DeleteRegistrationButton({
  registrationId,
  registrationName
}: DeleteRegistrationButtonProps) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirmDelete = async () => {
    try {
      setDeleting(true)
      setError(null)

      const response = await fetch(`/api/admin/registrations/${registrationId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete registration')
      }

      router.push('/admin/registrations')
    } catch (err) {
      console.error('Error deleting registration:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete registration')
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-red-700 border border-red-300 hover:bg-red-50"
      >
        Delete Registration
      </button>

      <ConfirmationDialog
        isOpen={dialogOpen}
        title="Delete Registration"
        message={
          <div>
            <p>Are you sure you want to delete <strong>{registrationName}</strong>?</p>
            <p className="mt-2 text-sm text-gray-600">This will permanently delete the registration and all its categories. This cannot be undone.</p>
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDialogOpen(false)}
        isLoading={deleting}
        variant="danger"
      />
    </>
  )
}
