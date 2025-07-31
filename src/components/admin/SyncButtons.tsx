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
  const [loadingCounts, setLoadingCounts] = useState(true)
  const [lastSync, setLastSync] = useState<{ 
    emails?: { time: string; processed: number; failed: number }; 
    accounting?: { time: string; processed: number; failed: number } 
  }>({})

  // Fetch counts on component mount
  useEffect(() => {
    fetchCounts()
  }, [])

  const fetchCounts = async () => {
    setLoadingCounts(true)
    try {
      const [emailResponse, accountingResponse, emailSyncResponse, xeroSyncResponse] = await Promise.all([
        fetch('/api/admin/sync-emails'),
        fetch('/api/xero/status?timeWindow=24h'),
        fetch('/api/admin/system-events?type=email_sync&limit=1'),
        fetch('/api/admin/system-events?type=xero_sync&limit=1')
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
          pendingInvoices: accountingData.stats?.pending_invoices || 0,
          pendingPayments: accountingData.stats?.pending_payments || 0
        }))
      }

      // Get last sync times
      if (emailSyncResponse.ok) {
        const emailSyncData = await emailSyncResponse.json()
        if (emailSyncData.events && emailSyncData.events.length > 0) {
          const lastEvent = emailSyncData.events[0]
          setLastSync(prev => ({ 
            ...prev, 
            emails: {
              time: new Date(lastEvent.completed_at).toLocaleString(),
              processed: lastEvent.records_processed || 0,
              failed: lastEvent.records_failed || 0
            }
          }))
        }
      }

      if (xeroSyncResponse.ok) {
        const xeroSyncData = await xeroSyncResponse.json()
        if (xeroSyncData.events && xeroSyncData.events.length > 0) {
          const lastEvent = xeroSyncData.events[0]
          setLastSync(prev => ({ 
            ...prev, 
            accounting: {
              time: new Date(lastEvent.completed_at).toLocaleString(),
              processed: lastEvent.records_processed || 0,
              failed: lastEvent.records_failed || 0
            }
          }))
        }
      }
    } catch (error) {
      console.error('Failed to fetch sync counts:', error)
    } finally {
      setLoadingCounts(false)
    }
  }

  const handleEmailSync = async () => {
    setLoading(prev => ({ ...prev, emails: true }))
    try {
      const response = await fetch('/api/admin/sync-emails', { method: 'POST' })
      if (response.ok) {
        setLastSync(prev => ({ 
          ...prev, 
          emails: {
            time: new Date().toLocaleTimeString(),
            processed: 0,
            failed: 0
          }
        }))
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
      const response = await fetch('/api/xero/manual-sync', { method: 'POST' })
      if (response.ok) {
        setLastSync(prev => ({ 
          ...prev, 
          accounting: {
            time: new Date().toLocaleTimeString(),
            processed: 0,
            failed: 0
          }
        }))
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

  const totalPendingEmails = counts.pendingEmails
  const totalPendingAccounting = counts.pendingInvoices + counts.pendingPayments

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Email Sync Button */}
      <div className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
        <button
          onClick={handleEmailSync}
          disabled={loading.emails || loadingCounts || totalPendingEmails === 0}
          className="w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="text-gray-900 font-medium flex items-center justify-between">
            <span>📧 Sync Emails</span>
            {loading.emails && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {loadingCounts ? (
              <span className="text-blue-600 font-medium flex items-center">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
                Checking status...
              </span>
            ) : totalPendingEmails > 0 ? (
              <span className="text-orange-600 font-medium">
                {totalPendingEmails} pending emails
              </span>
            ) : (
              <span className="text-green-600 font-medium">
                ✅ All emails synced
              </span>
            )}
          </div>
          {counts.pendingEmails > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {counts.pendingEmails} staged • {counts.failedEmails} failed
            </div>
          )}
          {lastSync.emails && (
            <div className="mt-1 text-xs text-blue-600">
              Last synced: {lastSync.emails.time}
              {lastSync.emails.processed > 0 && (
                <span> • {lastSync.emails.processed} processed</span>
              )}
              {lastSync.emails.failed > 0 && (
                <span className="text-red-600"> • {lastSync.emails.failed} failed</span>
              )}
            </div>
          )}
        </button>
      </div>

      {/* Accounting Sync Button */}
      <div className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-6 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
        <button
          onClick={handleAccountingSync}
          disabled={loading.accounting || loadingCounts || totalPendingAccounting === 0}
          className="w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="text-gray-900 font-medium flex items-center justify-between">
            <span>📊 Sync Accounting</span>
            {loading.accounting && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {loadingCounts ? (
              <span className="text-blue-600 font-medium flex items-center">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
                Checking status...
              </span>
            ) : totalPendingAccounting > 0 ? (
              <span className="text-orange-600 font-medium">
                {totalPendingAccounting} pending records
              </span>
            ) : (
              <span className="text-green-600 font-medium">
                ✅ All records synced
              </span>
            )}
          </div>
          {totalPendingAccounting > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {counts.pendingInvoices} invoices • {counts.pendingPayments} payments
            </div>
          )}
          {lastSync.accounting && (
            <div className="mt-1 text-xs text-blue-600">
              Last synced: {lastSync.accounting.time}
              {lastSync.accounting.processed > 0 && (
                <span> • {lastSync.accounting.processed} processed</span>
              )}
              {lastSync.accounting.failed > 0 && (
                <span className="text-red-600"> • {lastSync.accounting.failed} failed</span>
              )}
            </div>
          )}
        </button>
      </div>
    </div>
  )
} 