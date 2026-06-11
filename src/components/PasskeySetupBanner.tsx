'use client'

import { useState, useEffect } from 'react'
import { KeyRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import {
  isWebAuthnSupported,
  isUserCancelledError,
  isDuplicateRegistrationError,
  isUnsupportedOriginError,
  isPasskeyPromptEligible,
  getNextSnoozeDate,
  type PasskeyPromptPrefs,
} from '@/lib/passkeys'

interface PasskeySetupBannerProps {
  promptPrefs: PasskeyPromptPrefs | null
}

export default function PasskeySetupBanner({ promptPrefs }: PasskeySetupBannerProps) {
  const [visible, setVisible] = useState(false)
  const [registering, setRegistering] = useState(false)
  const supabase = createClient()
  const { showSuccess, showError } = useToast()

  const dismissCount = promptPrefs?.dismissCount ?? 0

  useEffect(() => {
    if (!isPasskeyPromptEligible(promptPrefs) || !isWebAuthnSupported()) {
      return
    }

    let cancelled = false
    const checkExistingPasskeys = async () => {
      const { data, error } = await supabase.auth.passkey.list()
      if (cancelled) return
      // Only show the banner when we know the user has no passkeys
      if (!error && (data?.length ?? 0) === 0) {
        setVisible(true)
      }
    }

    checkExistingPasskeys()
    return () => { cancelled = true }
  }, [])

  const savePromptPrefs = async (prefs: PasskeyPromptPrefs) => {
    try {
      await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkeyPrompt: prefs }),
      })
    } catch (error) {
      // Non-critical: worst case the banner shows again next visit
      console.error('Error saving passkey prompt preferences:', error)
    }
  }

  const handleSetUp = async () => {
    setRegistering(true)
    try {
      const { error } = await supabase.auth.registerPasskey()

      if (error) {
        if (isUserCancelledError(error)) {
          return // User dismissed the OS dialog — keep the banner, no toast
        }
        if (isDuplicateRegistrationError(error)) {
          showError('Already registered', 'This device already has a passkey for your account.')
          setVisible(false)
          return
        }
        if (isUnsupportedOriginError(error)) {
          showError('Passkeys unavailable', 'Passkeys aren\'t available on this site.')
          setVisible(false)
          return
        }
        showError('Passkey setup failed', error.message || 'Something went wrong. You can try again from your account page.')
        return
      }

      showSuccess('Passkey created!', 'You can now sign in with your passkey. Manage it from your account page.')
      setVisible(false)
    } catch (error: any) {
      if (!isUserCancelledError(error)) {
        console.error('Passkey registration error:', error)
        showError('Passkey setup failed', 'Something went wrong. You can try again from your account page.')
      }
    } finally {
      setRegistering(false)
    }
  }

  const handleRemindLater = () => {
    setVisible(false)
    savePromptPrefs({
      snoozedUntil: getNextSnoozeDate(dismissCount),
      dismissCount: dismissCount + 1,
    })
  }

  const handleDontAskAgain = () => {
    setVisible(false)
    savePromptPrefs({
      ...promptPrefs,
      optedOut: true,
    })
  }

  if (!visible) {
    return null
  }

  return (
    <div className="p-4 rounded-md bg-blue-50 border border-blue-200 mb-6">
      <div className="flex">
        <div className="flex-shrink-0">
          <KeyRound className="h-5 w-5 text-blue-500" />
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-blue-800">Sign in faster — and more securely — with a passkey</h3>
          <div className="mt-1 text-sm text-blue-700">
            Use your fingerprint, face, or device PIN instead of email codes. Passkeys can&apos;t be phished or intercepted.
          </div>
          <div className="mt-3 flex items-center space-x-4">
            <button
              onClick={handleSetUp}
              disabled={registering}
              className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {registering ? 'Waiting for your device...' : 'Set up passkey'}
            </button>
            <button
              onClick={handleRemindLater}
              disabled={registering}
              className="text-sm font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
            >
              Remind me later
            </button>
            {dismissCount >= 2 && (
              <button
                onClick={handleDontAskAgain}
                disabled={registering}
                className="text-sm text-blue-500 hover:text-blue-700 underline disabled:opacity-50"
              >
                Don&apos;t ask again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
