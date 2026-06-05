'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface Recipient {
  userId: string
  email: string
  name: string
}

interface EmailComposerModalProps {
  recipients: Recipient[]
  apiEndpoint: string
  onClose: () => void
}

export default function EmailComposerModal({
  recipients,
  apiEndpoint,
  onClose,
}: EmailComposerModalProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showRecipients, setShowRecipients] = useState(false)
  const { showSuccess, showError } = useToast()

  const subjectTrimmed = subject.trim()
  const bodyTrimmed = body.trim()
  const isValid = subjectTrimmed.length > 0 && bodyTrimmed.length > 0

  const handleSend = async () => {
    if (!isValid || isSending) return
    setIsSending(true)
    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subjectTrimmed,
          body: bodyTrimmed,
          recipientUserIds: recipients.map(r => r.userId),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showError(data.error || 'Failed to send email')
        return
      }
      const data = await res.json()
      showSuccess(`Email queued for ${data.queued} recipient${data.queued !== 1 ? 's' : ''}`)
      onClose()
    } catch {
      showError('Failed to send email')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Email Team</h2>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Recipients */}
          <div>
            <button
              type="button"
              onClick={() => setShowRecipients(v => !v)}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Sending to {recipients.length} player{recipients.length !== 1 ? 's' : ''}{' '}
              {showRecipients ? '▲' : '▼'}
            </button>
            {showRecipients && (
              <ul className="mt-2 text-sm text-gray-700 max-h-32 overflow-y-auto border border-gray-200 rounded p-2 space-y-0.5">
                {recipients.map(r => (
                  <li key={r.userId}>{r.name}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="Email subject"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message <span className="text-red-500">*</span>
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm resize-y"
              placeholder="Your message (plain text)"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!isValid || isSending}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
