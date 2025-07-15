'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

interface XeroToken {
  tenant_id: string
  tenant_name: string
  expires_at: string
  created_at: string
  is_expired: boolean
  is_valid: boolean
  status: string
}

interface SyncLog {
  id: string
  operation_type: string
  entity_type: string
  status: string
  error_message?: string
  created_at: string
}

interface FailedItem {
  id: string
  tenant_id: string
  sync_status: string
  sync_error: string | null
  last_synced_at: string
  staging_metadata?: any
  users?: {
    first_name: string | null
    last_name: string | null
    member_id: string | null
  } | null
}

interface SyncStats {
  total_operations: number
  successful_operations: number
  failed_operations: number
  recent_operations: SyncLog[]
  pending_invoices: number
  pending_payments: number
  total_pending: number
  failed_invoices: FailedItem[]
  failed_payments: FailedItem[]
  failed_count: number
}

function XeroIntegrationContent() {
  const [isXeroConnected, setIsXeroConnected] = useState(false)
  const [currentToken, setCurrentToken] = useState<XeroToken | null>(null)
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [selectedFailedItems, setSelectedFailedItems] = useState<Set<string>>(new Set())
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showError, showSuccess } = useToast()

  const fetchXeroStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/xero/status')
      if (response.ok) {
        const data = await response.json()
        setIsXeroConnected(data.has_active_connection)
        if (data.connections && data.connections.length > 0) {
          setCurrentToken(data.connections[0])
        }
        setSyncStats(data.stats)
      }
    } catch (error) {
      console.error('Error fetching Xero status:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchXeroStatus()
  }, [fetchXeroStatus])

  useEffect(() => {
    // Handle OAuth callback results
    const xeroError = searchParams.get('xero_error')
    const xeroSuccess = searchParams.get('xero_success')
    const tenants = searchParams.get('tenants')
    
    if (xeroError) {
      showError(getErrorMessage(xeroError))
      // Clean up URL parameters
      router.replace('/admin/accounting/xero', { scroll: false })
    } else if (xeroSuccess === 'connected') {
      const tenantNames = tenants ? decodeURIComponent(tenants) : 'your organization'
      showSuccess(`Successfully connected to Xero: ${tenantNames}`)
      // Clean up URL parameters and refresh data
      router.replace('/admin/accounting/xero', { scroll: false })
      // Refresh the data after successful connection
      setTimeout(() => {
        fetchXeroStatus()
      }, 1000)
    }
  }, [searchParams, router]) // Removed showError, showSuccess from dependencies

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showDisconnectModal) {
        setShowDisconnectModal(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showDisconnectModal])

  const handleDisconnect = () => {
    setShowDisconnectModal(true)
  }

  const confirmDisconnect = async () => {
    setShowDisconnectModal(false)
    setDisconnecting(true)
    
    try {
      const response = await fetch('/api/xero/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      if (response.ok) {
        showSuccess('Successfully disconnected from Xero')
        // Refresh the page state
        setIsXeroConnected(false)
        setCurrentToken(null)
        setSyncStats(null)
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Failed to disconnect from Xero')
      }
    } catch (error) {
      showError('Failed to disconnect from Xero')
    } finally {
      setDisconnecting(false)
    }
  }

  const handleManualSync = async () => {
    setSyncing(true)
    
    try {
      const response = await fetch('/api/xero/manual-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json()
        showSuccess(`Manual sync completed: ${data.results.total_synced} synced, ${data.results.total_failed} failed`)
        // Refresh the status to get updated counts
        await fetchXeroStatus()
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Failed to trigger manual sync')
      }
    } catch (error) {
      showError('Failed to trigger manual sync')
    } finally {
      setSyncing(false)
    }
  }

  const handleRetryFailed = async (type: 'all' | 'selected') => {
    setRetrying(true)
    
    try {
      const items = type === 'selected' ? Array.from(selectedFailedItems) : []
      
      const response = await fetch('/api/xero/retry-failed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, items }),
      })

      if (response.ok) {
        const data = await response.json()
        const resetCount = data.reset_results.invoices + data.reset_results.payments
        const syncedCount = data.sync_results.total_synced
        showSuccess(`Retry completed: ${resetCount} items reset, ${syncedCount} synced successfully`)
        
        // Clear selections
        setSelectedFailedItems(new Set())
        
        // Refresh the status to get updated counts
        await fetchXeroStatus()
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Failed to retry failed items')
      }
    } catch (error) {
      showError('Failed to retry failed items')
    } finally {
      setRetrying(false)
    }
  }

  const handleFailedItemToggle = (itemId: string) => {
    const newSelection = new Set(selectedFailedItems)
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId)
    } else {
      newSelection.add(itemId)
    }
    setSelectedFailedItems(newSelection)
  }

  const handleSelectAllFailed = () => {
    if (!syncStats) return
    
    const allFailedIds = [
      ...syncStats.failed_invoices.map(item => `inv_${item.id}`),
      ...syncStats.failed_payments.map(item => `pay_${item.id}`)
    ]
    
    if (selectedFailedItems.size === allFailedIds.length) {
      setSelectedFailedItems(new Set()) // Deselect all
    } else {
      setSelectedFailedItems(new Set(allFailedIds)) // Select all
    }
  }

  const getErrorMessage = (errorCode: string): string => {
    switch (errorCode) {
      case 'access_denied':
        return 'Access was denied. Please try again and accept the permissions.'
      case 'no_code':
        return 'No authorization code received from Xero. Please try again.'
      case 'token_exchange_failed':
        return 'Failed to exchange authorization code for tokens. Please try again.'
      case 'no_tenants':
        return 'No Xero organizations found. Please ensure you have access to at least one Xero organization.'
      case 'token_storage_failed':
        return 'Failed to store Xero tokens. Please check your database connection.'
      case 'callback_failed':
        return 'OAuth callback failed. Please try again.'
      default:
        return `Connection failed: ${errorCode}. Please try again.`
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
          <div className="space-y-6">
            <div className="h-32 bg-gray-200 rounded"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Xero Integration</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your Xero accounting integration and sync settings
        </p>
      </div>

      <div className="space-y-6">
        {/* Connection Status */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Connection Status</h2>
          
          {isXeroConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-green-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <h3 className="text-sm font-medium text-green-800">Connected to Xero</h3>
                    <p className="text-sm text-green-700">
                      Active Organization: {currentToken?.tenant_name}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-green-600">
                  Connected {currentToken?.created_at && new Date(currentToken.created_at).toLocaleDateString()}
                </div>
              </div>

              {/* Token Status Information */}
              <div className="space-y-3">
                {/* Access Token Status (Informational) */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start">
                    <svg className="h-5 w-5 text-blue-400 mr-3 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-blue-800">Token Status</h3>
                      <div className="mt-1 text-xs text-blue-700 space-y-1">
                        <p>
                          <strong>Access Token:</strong> {currentToken?.expires_at ? (
                            new Date(currentToken.expires_at) > new Date() 
                              ? `Active until ${new Date(currentToken.expires_at).toLocaleString()}`
                              : 'Expired (will refresh automatically)'
                          ) : 'Unknown'}
                        </p>
                        <p>
                          <strong>Refresh Token:</strong> {currentToken?.created_at ? (
                            `Valid until ${new Date(new Date(currentToken.created_at).getTime() + (60 * 24 * 60 * 60 * 1000)).toLocaleString()}`
                          ) : 'Unknown'}
                        </p>
                        <p className="text-blue-600 text-xs">
                          Access tokens expire every 30 minutes for security and are automatically refreshed. 
                          Refresh tokens are valid for 60 days and allow the system to obtain new access tokens without requiring you to reconnect.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Refresh Token Warning (Only if expiring within 7 days) */}
                {currentToken?.created_at && new Date(currentToken.created_at).getTime() + (60 * 24 * 60 * 60 * 1000) < new Date().getTime() + (7 * 24 * 60 * 60 * 1000) && (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-center">
                      <svg className="h-5 w-5 text-yellow-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <div>
                        <h3 className="text-sm font-medium text-yellow-800">Refresh Token Expiring Soon</h3>
                        <p className="text-sm text-yellow-700">
                          Your Xero refresh token expires on {new Date(new Date(currentToken.created_at).getTime() + (60 * 24 * 60 * 60 * 1000)).toLocaleString()}. 
                          You'll need to reconnect to Xero before this date to maintain access.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center">
                <svg className="h-5 w-5 text-yellow-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <h3 className="text-sm font-medium text-yellow-800">Not Connected</h3>
                  <p className="text-sm text-yellow-700">
                    Connect to a Xero organization to enable automatic syncing of invoices and payments
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pending Items & Sync Activity (only show if connected) */}
        {isXeroConnected && syncStats && (
          <>
            {/* Pending Items Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Pending Sync Items</h2>
                <button
                  onClick={handleManualSync}
                  disabled={syncing || syncStats.total_pending === 0}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {syncing ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Syncing...
                    </>
                  ) : (
                    <>
                      <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                      Sync Now
                    </>
                  )}
                </button>
              </div>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{syncStats.pending_invoices}</div>
                  <div className="text-sm text-blue-800">Pending Invoices</div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{syncStats.pending_payments}</div>
                  <div className="text-sm text-purple-800">Pending Payments</div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{syncStats.total_pending}</div>
                  <div className="text-sm text-orange-800">Total Pending</div>
                </div>
              </div>

              {syncStats.total_pending === 0 && (
                <div className="text-center py-4">
                  <div className="text-green-600 text-sm font-medium">✅ All items are synced to Xero</div>
                  <div className="text-gray-500 text-xs mt-1">The automatic sync service runs every 2 minutes</div>
                </div>
              )}
            </div>

            {/* Sync Activity Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Sync Activity (Last 24 Hours)</h2>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{syncStats.successful_operations}</div>
                  <div className="text-sm text-green-800">Successful Syncs</div>
                </div>
                <div className="bg-red-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{syncStats.failed_operations}</div>
                  <div className="text-sm text-red-800">Failed Syncs</div>
                </div>
              </div>

              {syncStats.recent_operations && syncStats.recent_operations.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Recent Activity</h3>
                  <div className="space-y-2">
                    {syncStats.recent_operations.slice(0, 3).map((log, index) => (
                      <div key={log.id || `log-${index}`} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center">
                          <div className={`w-2 h-2 rounded-full mr-3 ${
                            log.status === 'success' ? 'bg-green-400' : 
                            log.status === 'error' ? 'bg-red-400' : 
                            'bg-yellow-400'
                          }`}></div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {log.operation_type.replace('_', ' ')} - {log.entity_type}
                            </div>
                            {log.error_message && (
                              <div className="text-xs text-red-600">{log.error_message}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Failed Sync Items Section - only show if there are failed items */}
            {syncStats.failed_count > 0 && (
              <div className="bg-white rounded-lg border border-red-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <h2 className="text-lg font-semibold text-gray-900">Failed Sync Items</h2>
                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      {syncStats.failed_count} failed
                    </span>
                  </div>
                  <div className="flex space-x-2">
                    {selectedFailedItems.size > 0 && (
                      <button
                        onClick={() => handleRetryFailed('selected')}
                        disabled={retrying}
                        className="inline-flex items-center px-3 py-2 border border-orange-300 text-sm font-medium rounded-md text-orange-700 bg-orange-50 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {retrying ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Retrying...
                          </>
                        ) : (
                          <>
                            <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                            </svg>
                            Retry Selected ({selectedFailedItems.size})
                          </>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleRetryFailed('all')}
                      disabled={retrying}
                      className="inline-flex items-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {retrying ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Retrying...
                        </>
                      ) : (
                        <>
                          <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                          </svg>
                          Retry All
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Failed Items List */}
                <div className="space-y-3">
                  {/* Select All Checkbox */}
                  <div className="flex items-center pb-2 border-b border-gray-200">
                    <input
                      type="checkbox"
                      checked={selectedFailedItems.size === syncStats.failed_count && syncStats.failed_count > 0}
                      onChange={handleSelectAllFailed}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label className="ml-2 text-sm font-medium text-gray-700">
                      Select All ({syncStats.failed_count} items)
                    </label>
                  </div>

                  {/* Failed Invoices */}
                  {syncStats.failed_invoices.map((item) => {
                    const itemId = `inv_${item.id}`
                    const isSelected = selectedFailedItems.has(itemId)
                    const user = item.users
                    
                    // Use Xero contact naming convention: "First Last - MemberID"
                    const userDisplayName = user?.first_name && user?.last_name 
                      ? user.member_id 
                        ? `${user.first_name} ${user.last_name} - ${user.member_id}`
                        : `${user.first_name} ${user.last_name}`
                      : 'Unknown User'
                    
                    return (
                      <div key={itemId} className="flex items-start p-3 bg-red-50 rounded-lg border border-red-200">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleFailedItemToggle(itemId)}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <div className="ml-3 flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                Invoice
                              </span>
                              <span className="ml-2 text-sm font-medium text-gray-900">
                                {userDisplayName}
                              </span>
                            </div>
                            <time className="text-xs text-gray-500">
                              {new Date(item.last_synced_at).toLocaleString()}
                            </time>
                          </div>
                          {item.sync_error && (
                            <p className="mt-1 text-sm text-red-600">{item.sync_error}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Failed Payments */}
                  {syncStats.failed_payments.map((item) => {
                    const itemId = `pay_${item.id}`
                    const isSelected = selectedFailedItems.has(itemId)
                    const user = item.users
                    
                    // Use Xero contact naming convention: "First Last - MemberID"
                    const userDisplayName = user?.first_name && user?.last_name 
                      ? user.member_id 
                        ? `${user.first_name} ${user.last_name} - ${user.member_id}`
                        : `${user.first_name} ${user.last_name}`
                      : 'Unknown User'
                    
                    return (
                      <div key={itemId} className="flex items-start p-3 bg-red-50 rounded-lg border border-red-200">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleFailedItemToggle(itemId)}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <div className="ml-3 flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                Payment
                              </span>
                              <span className="ml-2 text-sm font-medium text-gray-900">
                                {userDisplayName}
                              </span>
                            </div>
                            <time className="text-xs text-gray-500">
                              {new Date(item.last_synced_at).toLocaleString()}
                            </time>
                          </div>
                          {item.sync_error && (
                            <p className="mt-1 text-sm text-red-600">{item.sync_error}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Management Actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Management</h2>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {isXeroConnected ? (
              <>
                <Link
                  href="/admin/accounting/xero/sync-status"
                  className="relative block w-full border border-gray-300 rounded-lg p-4 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <div className="text-gray-900 font-medium text-sm">View Sync Logs</div>
                      <div className="mt-1 text-xs text-gray-500">Detailed sync history and errors</div>
                    </div>
                  </div>
                </Link>

                <Link
                  href="/admin/accounting/xero/settings"
                  className="relative block w-full border border-gray-300 rounded-lg p-4 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <div className="text-gray-900 font-medium text-sm">Sync Settings</div>
                      <div className="mt-1 text-xs text-gray-500">Configure sync preferences</div>
                    </div>
                  </div>
                </Link>

                <button 
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="relative block w-full border border-red-300 rounded-lg p-4 hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-red-300 cursor-pointer"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      {disconnecting ? (
                        <svg className="animate-spin h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      )}
                    </div>
                    <div className="ml-3">
                      <div className="text-red-900 font-medium text-sm">
                        {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                      </div>
                      <div className="mt-1 text-xs text-red-500">
                        {disconnecting ? 'Please wait...' : 'Remove Xero connection'}
                      </div>
                    </div>
                  </div>
                </button>
              </>
            ) : (
              <div className="col-span-full">
                <Link
                  href="/admin/accounting/xero/connect"
                  className="relative block w-full border border-blue-300 rounded-lg p-4 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <div className="text-blue-900 font-medium text-sm">Connect to Xero</div>
                      <div className="mt-1 text-xs text-blue-500">Set up Xero integration</div>
                    </div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-6 flex justify-between">
        <Link 
          href="/admin/accounting"
          className="text-blue-600 hover:text-blue-500 text-sm font-medium"
        >
          ← Back to Accounting Integration
        </Link>
        
        <Link 
          href="/admin"
          className="text-blue-600 hover:text-blue-500 text-sm font-medium"
        >
          Admin Dashboard
        </Link>
      </div>

      {/* Disconnect Confirmation Modal */}
      {showDisconnectModal && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
          onClick={() => setShowDisconnectModal(false)}
        >
          <div 
            className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mt-3 text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg leading-6 font-medium text-gray-900 mt-4">
                Disconnect from Xero?
              </h3>
              <div className="mt-2 px-7 py-3">
                <p className="text-sm text-gray-500">
                  Are you sure you want to disconnect from <strong>{currentToken?.tenant_name}</strong>? This will stop all automatic syncing of invoices and payments.
                </p>
              </div>
              <div className="flex justify-center space-x-4 mt-4">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-800 text-base font-medium rounded-md shadow-sm hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDisconnect}
                  disabled={disconnecting}
                  className="px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function XeroIntegrationPage() {
  return (
    <Suspense fallback={
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
          <div className="space-y-6">
            <div className="h-32 bg-gray-200 rounded"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    }>
      <XeroIntegrationContent />
    </Suspense>
  )
}