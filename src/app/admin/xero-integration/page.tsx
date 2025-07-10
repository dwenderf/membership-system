'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface XeroConnection {
  tenant_id: string
  tenant_name: string
  expires_at: string
  created_at: string
  is_expired: boolean
  is_valid: boolean
  status: 'connected' | 'expired' | 'error'
}

interface XeroStatus {
  connections: XeroConnection[]
  stats: {
    total_operations: number
    successful_operations: number
    failed_operations: number
    recent_operations: Array<{
      status: string
      operation_type: string
      created_at: string
    }>
  }
  is_configured: boolean
  has_active_connection: boolean
}

export default function XeroIntegrationPage() {
  const [status, setStatus] = useState<XeroStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    fetchStatus()
  }, [])

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/xero/status')
      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      } else {
        showToast('Failed to fetch Xero status', 'error')
      }
    } catch (error) {
      console.error('Error fetching Xero status:', error)
      showToast('Error loading Xero integration status', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = async () => {
    try {
      const response = await fetch('/api/xero/auth')
      if (response.ok) {
        const data = await response.json()
        window.location.href = data.consentUrl
      } else {
        showToast('Failed to initiate Xero connection', 'error')
      }
    } catch (error) {
      console.error('Error connecting to Xero:', error)
      showToast('Error initiating Xero connection', 'error')
    }
  }

  const handleDisconnect = async (tenantId: string) => {
    if (!confirm('Are you sure you want to disconnect this Xero organization?')) {
      return
    }

    try {
      const response = await fetch('/api/xero/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId })
      })

      if (response.ok) {
        showToast('Xero integration disconnected successfully', 'success')
        fetchStatus()
      } else {
        showToast('Failed to disconnect Xero integration', 'error')
      }
    } catch (error) {
      console.error('Error disconnecting Xero:', error)
      showToast('Error disconnecting Xero integration', 'error')
    }
  }

  const handleBulkSync = async (type: 'contacts' | 'invoices' | 'payments') => {
    if (!status?.connections.length) {
      showToast('No Xero connections available', 'error')
      return
    }

    setSyncing(true)
    try {
      const tenantId = status.connections[0].tenant_id
      const endpoint = `/api/xero/sync-${type}`
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, bulk_sync: true })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showToast(data.message, 'success')
        } else {
          showToast(data.message || `Failed to sync ${type}`, 'error')
        }
      } else {
        showToast(`Failed to sync ${type}`, 'error')
      }
    } catch (error) {
      console.error(`Error syncing ${type}:`, error)
      showToast(`Error syncing ${type}`, 'error')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Xero Integration</h1>
        <div className="text-center py-8">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Xero Integration</h1>

      {/* Connection Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Connection Status</h2>
        
        {!status?.is_configured ? (
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4">No Xero integration configured</p>
            <button
              onClick={handleConnect}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Connect to Xero
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {status.connections.map((connection) => (
              <div key={connection.tenant_id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium">{connection.tenant_name}</h3>
                    <p className="text-sm text-gray-600">
                      Status: <span className={`font-medium ${
                        connection.status === 'connected' ? 'text-green-600' : 
                        connection.status === 'expired' ? 'text-orange-600' : 'text-red-600'
                      }`}>
                        {connection.status}
                      </span>
                    </p>
                    <p className="text-sm text-gray-600">
                      Expires: {new Date(connection.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDisconnect(connection.tenant_id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync Operations */}
      {status?.has_active_connection && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Manual Sync Operations</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Sync Contacts</h3>
                <p className="text-sm text-gray-600">Create Xero contacts for all users who have made payments</p>
              </div>
              <button
                onClick={() => handleBulkSync('contacts')}
                disabled={syncing}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Sync Contacts
              </button>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Sync Invoices</h3>
                <p className="text-sm text-gray-600">Create Xero invoices for all completed payments</p>
              </div>
              <button
                onClick={() => handleBulkSync('invoices')}
                disabled={syncing}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Sync Invoices
              </button>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Record Payments</h3>
                <p className="text-sm text-gray-600">Record Stripe payments in Xero for all synced invoices</p>
              </div>
              <button
                onClick={() => handleBulkSync('payments')}
                disabled={syncing}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Record Payments
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      {status?.stats && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Sync Statistics (Last 24 Hours)</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{status.stats.total_operations}</div>
              <div className="text-sm text-gray-600">Total Operations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{status.stats.successful_operations}</div>
              <div className="text-sm text-gray-600">Successful</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{status.stats.failed_operations}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
          </div>
          
          {status.stats.recent_operations.length > 0 && (
            <div>
              <h3 className="font-medium mb-2">Recent Operations</h3>
              <div className="space-y-1 text-sm">
                {status.stats.recent_operations.slice(0, 5).map((op, index) => (
                  <div key={index} className="flex justify-between">
                    <span>{op.operation_type}</span>
                    <span className={op.status === 'success' ? 'text-green-600' : 'text-red-600'}>
                      {op.status}
                    </span>
                    <span className="text-gray-500">
                      {new Date(op.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Auto-sync Info */}
      {status?.has_active_connection && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-medium text-blue-900 mb-2">Automatic Sync Enabled</h3>
          <p className="text-sm text-blue-800">
            All new payments are automatically synced to Xero as invoices and payment records. 
            Manual sync operations above are for catching up on historical data or retrying failed syncs.
          </p>
        </div>
      )}
    </div>
  )
}