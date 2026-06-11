'use client'

import ConfirmationDialog from '@/components/ConfirmationDialog'

interface PasskeyRemovalHelpDialogProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Explains how to remove a leftover passkey from the user's device.
 * Sites can't delete credentials from a device's password manager, so after
 * a passkey is deleted from the account the device copy must be removed by hand.
 */
export default function PasskeyRemovalHelpDialog({ isOpen, onClose }: PasskeyRemovalHelpDialogProps) {
  // Passkeys are filed under the site's domain in password managers
  const domain = typeof window !== 'undefined' ? window.location.hostname : ''

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      title="Removing a passkey from your device"
      variant="info"
      hideButtons
      onConfirm={onClose}
      onCancel={onClose}
      message={
        <div className="space-y-3">
          <p>
            Deleting a passkey from your account stops it from working, but your device&apos;s
            password manager may still list it. To remove it completely, look for{' '}
            <strong>{domain}</strong>:
          </p>
          <ul className="list-disc list-inside space-y-2">
            <li>
              <strong>iPhone / iPad:</strong> open the <strong>Passwords</strong> app (or
              Settings → Passwords on older iOS), search for the site, and delete the passkey.
            </li>
            <li>
              <strong>Mac:</strong> open the <strong>Passwords</strong> app (press ⌘ Space and
              type &quot;Passwords&quot;), search for the site, and delete it. It won&apos;t
              appear in the older Keychain Access app.
            </li>
            <li>
              <strong>Other password managers:</strong> if you saved it with Chrome (Google
              Password Manager), 1Password, Bitwarden, or similar, open that app and search for
              the site there.
            </li>
          </ul>
          <p>
            Passkeys saved to iCloud Keychain sync across your Apple devices — deleting one there
            removes it from all of them.
          </p>
        </div>
      }
    />
  )
}
