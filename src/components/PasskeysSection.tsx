'use client'

import { useState, useEffect } from 'react'
import { KeyRound, Pencil, Trash2, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { formatDate } from '@/lib/date-utils'
import {
  isWebAuthnSupported,
  isUserCancelledError,
  isDuplicateRegistrationError,
  isUnsupportedOriginError,
} from '@/lib/passkeys'

interface PasskeyItem {
  id: string
  friendly_name?: string
  created_at: string
  last_used_at?: string
}

export default function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [supported, setSupported] = useState(false)
  const [adding, setAdding] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [savingRename, setSavingRename] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PasskeyItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const supabase = createClient()
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    setSupported(isWebAuthnSupported())
    loadPasskeys()
  }, [])

  const loadPasskeys = async () => {
    const { data, error } = await supabase.auth.passkey.list()
    if (error) {
      console.error('Error loading passkeys:', error)
    } else {
      setPasskeys(data ?? [])
    }
    setLoading(false)
  }

  const handleAdd = async () => {
    setAdding(true)
    try {
      const { error } = await supabase.auth.registerPasskey()

      if (error) {
        if (isUserCancelledError(error)) {
          return // User dismissed the OS dialog
        }
        if (isDuplicateRegistrationError(error)) {
          showError('Already registered', 'This device already has a passkey for your account.')
          return
        }
        if (isUnsupportedOriginError(error)) {
          showError('Passkeys unavailable', 'Passkeys aren\'t available on this site.')
          return
        }
        showError('Passkey setup failed', error.message || 'Something went wrong. Please try again.')
        return
      }

      showSuccess('Passkey created!', 'You can now sign in with your passkey.')
      await loadPasskeys()
    } catch (error: any) {
      if (!isUserCancelledError(error)) {
        console.error('Passkey registration error:', error)
        showError('Passkey setup failed', 'Something went wrong. Please try again.')
      }
    } finally {
      setAdding(false)
    }
  }

  const startRename = (passkey: PasskeyItem) => {
    setRenamingId(passkey.id)
    setRenameValue(passkey.friendly_name || '')
  }

  const handleRename = async () => {
    if (!renamingId) return
    const friendlyName = renameValue.trim()
    if (!friendlyName) return

    setSavingRename(true)
    try {
      const { error } = await supabase.auth.passkey.update({
        passkeyId: renamingId,
        friendlyName,
      })

      if (error) {
        showError('Rename failed', error.message || 'Could not rename this passkey.')
      } else {
        showSuccess('Passkey renamed', `Now called "${friendlyName}".`)
        setRenamingId(null)
        await loadPasskeys()
      }
    } finally {
      setSavingRename(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: deleteTarget.id })

      if (error) {
        showError('Delete failed', error.message || 'Could not delete this passkey.')
      } else {
        showSuccess('Passkey deleted', 'You may also want to remove it from your device\'s password manager.')
        await loadPasskeys()
      }
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-start">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Passkeys</h2>
          <p className="mt-1 text-sm text-gray-600">
            Sign in with your fingerprint, face, or device PIN instead of email codes
          </p>
        </div>
        {supported && (
          <button
            onClick={handleAdd}
            disabled={adding}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors min-w-[120px] text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? 'Waiting...' : 'Add Passkey'}
          </button>
        )}
      </div>
      <div className="px-6 py-4">
        {!supported && (
          <p className="text-sm text-gray-500">
            This browser doesn&apos;t support passkeys. Any passkeys you&apos;ve created on other
            devices are listed below and can be removed here.
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading passkeys...</p>
        ) : passkeys.length === 0 ? (
          supported ? (
            <div className="flex items-start">
              <KeyRound className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="ml-3 text-sm text-gray-600">
                You don&apos;t have any passkeys yet. Add one to sign in faster and more securely —
                no email codes needed.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">No passkeys on your account.</p>
          )
        ) : (
          <ul className="divide-y divide-gray-200">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center min-w-0">
                  <KeyRound className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  <div className="ml-3 min-w-0">
                    {renamingId === passkey.id ? (
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename()
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          maxLength={120}
                          autoFocus
                          className="block w-48 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          onClick={handleRename}
                          disabled={savingRename || !renameValue.trim()}
                          className="text-green-600 hover:text-green-800 disabled:opacity-50"
                          title="Save name"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setRenamingId(null)}
                          disabled={savingRename}
                          className="text-gray-400 hover:text-gray-600"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {passkey.friendly_name || 'Unnamed passkey'}
                      </p>
                    )}
                    <p className="text-sm text-gray-500">
                      Added {formatDate(passkey.created_at)}
                      {' · '}
                      {passkey.last_used_at ? `Last used ${formatDate(passkey.last_used_at)}` : 'Never used'}
                    </p>
                  </div>
                </div>
                {renamingId !== passkey.id && (
                  <div className="flex items-center space-x-3 ml-4 flex-shrink-0">
                    <button
                      onClick={() => startRename(passkey)}
                      className="text-gray-400 hover:text-gray-600"
                      title="Rename passkey"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(passkey)}
                      className="text-gray-400 hover:text-red-600"
                      title="Delete passkey"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        title="Delete Passkey"
        message={
          <>
            <p>
              Are you sure you want to delete{' '}
              <strong>{deleteTarget?.friendly_name || 'this passkey'}</strong>? You won&apos;t be
              able to sign in with it anymore.
            </p>
            <p className="mt-2">
              Your device&apos;s password manager (e.g. iCloud Keychain) will still show this
              passkey until you remove it there too — but it will no longer work after you delete
              it here.
            </p>
            <p className="mt-2">
              You can still sign in with email or Google, so you won&apos;t be locked out of your
              account.
            </p>
          </>
        }
        confirmText="Delete"
        variant="danger"
        isLoading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
