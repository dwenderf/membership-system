'use client'

import { formatDateTime } from '@/lib/date-utils'

interface SyncStatusProps {
  lastSyncedAt?: string | null
  itemCount?: number
  loading?: boolean
  error?: string | null
  label?: string
}

/**
 * Reusable sync status display component
 * Shows last sync time, item count, loading state, and errors
 * Used in admin dashboard and accounting codes page
 */
export default function SyncStatus({
  lastSyncedAt,
  itemCount,
  loading,
  error,
  label = 'Last synced'
}: SyncStatusProps) {
  if (loading) {
    return (
      <div className="text-xs text-blue-600 flex items-center">
        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
        Syncing...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-xs text-red-600">
        ⚠️ {error}
      </div>
    )
  }

  if (!lastSyncedAt) {
    return (
      <div className="text-xs text-gray-400">
        Never synced
      </div>
    )
  }

  return (
    <div className="text-xs text-blue-600">
      {label}: {formatDateTime(lastSyncedAt)}
      {itemCount !== undefined && (
        <span className="ml-2 text-gray-600">• {itemCount} {itemCount === 1 ? 'account' : 'accounts'}</span>
      )}
    </div>
  )
}
