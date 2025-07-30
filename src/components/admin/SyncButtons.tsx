'use client'

import { useState, useEffect } from 'react'

interface SyncCounts {
  pendingEmails: number
  failedEmails: number
  pendingInvoices: number
  pendingPayments: number
}

export default function SyncButtons() {
  const [counts, setCounts] = useState<SyncCounts>({
    pendingEmails: 0,
    failedEmails: 0,
    pendingInvoices: 0,
    pendingPayments: 0
  })
  const [loading, setLoading] = useState({ emails: false, accounting: false })
  const [lastSync, setLastSync] = useState<{ emails?: string; accounting?: string }>({})

  // Fetch counts on component mount
  useEffect(() => {
    fetchCounts()
  }, [])

  const fetchCounts = async () => {
    try {
      const [emailResponse, accountingResponse] = await Promise.all([
        fetch('/api/admin/sync-emails'),
        fetch('/api/admin/sync-accounting')
      ])

      if (emailResponse.ok) {
        const emailData = await emailResponse.json()
        setCounts(prev => ({
          ...prev,
          pendingEmails: emailData.pendingEmails,
          failedEmails: emailData.failedEmails
        }))
      }

      if (accountingResponse.ok) {
        const accountingData = await accountingResponse.json()
        setCounts(prev => ({
          ...prev,
          pendingInvoices: accountingData.pendingInvoices,
          pendingPayments: accountingData.pendingPayments
        }))
      }
    } catch (error) {
      console.error('Failed to fetch sync counts:', error)
    }
  }

  const handleEmailSync = async () => {
    setLoading(prev => ({ ...prev, emails: true }))
    try {
      const response = await fetch('/api/admin/sync-emails', { method: 'POST' })
      if (response.ok) {
        setLastSync(prev => ({ ...prev, emails: new Date().toLocaleTimeString() }))
        await fetchCounts() // Refresh counts
      } else {
        console.error('Email sync failed')
      }
    } catch (error) {
      console.error('Email sync error:', error)
    } finally {
      setLoading(prev => ({ ...prev, emails: false }))
    }
  }

  const handleAccountingSync = async () => {
    setLoading(prev => ({ ...prev, accounting: true }))
    try {
      const response = await fetch('/api/admin/sync-accounting', { method: 'POST' })
      if (response.ok) {
        setLastSync(prev => ({ ...prev, accounting: new Date().toLocaleTimeString() }))
        await fetchCounts() // Refresh counts
      } else {
        console.error('Accounting sync failed')
      }
    } catch (error) {
      console.error('Accounting sync error:', error)
    } finally {
      setLoading(prev => ({ ...prev, accounting: false }))
    }
  }

  const totalPendingEmails = counts.pendingEmails + counts.failedEmails
  const totalPendingAccounting = counts.pendingInvoices + counts.pendingPayments

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Email Sync Button */}
      <div className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
        <button
          onClick={handleEmailSync}
          disabled={loading.emails}
          className="w-full text-left"
        >
          <div className="text-gray-900 font-medium flex items-center justify-between">
            <span>📧 Sync Emails</span>
            {loading.emails && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {totalPendingEmails > 0 ? (
              <span className="text-orange-600 font-medium">
                {totalPendingEmails} pending emails
              </span>
            ) : (
              'No pending emails'
            )}
          </div>
          {counts.pendingEmails > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {counts.pendingEmails} staged • {counts.failedEmails} failed
            </div>
          )}
          {lastSync.emails && (
            <div className="mt-1 text-xs text-green-600">
              Last synced: {lastSync.emails}
            </div>
          )}
        </button>
      </div>

      {/* Accounting Sync Button */}
      <div className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
        <button
          onClick={handleAccountingSync}
          disabled={loading.accounting}
          className="w-full text-left"
        >
          <div className="text-gray-900 font-medium flex items-center justify-between">
            <span>📊 Sync Accounting</span>
            {loading.accounting && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {totalPendingAccounting > 0 ? (
              <span className="text-orange-600 font-medium">
                {totalPendingAccounting} pending records
              </span>
            ) : (
              'No pending records'
            )}
          </div>
          {totalPendingAccounting > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {counts.pendingInvoices} invoices • {counts.pendingPayments} payments
            </div>
          )}
          {lastSync.accounting && (
            <div className="mt-1 text-xs text-green-600">
              Last synced: {lastSync.accounting}
            </div>
          )}
        </button>
      </div>
    </div>
  )
} 