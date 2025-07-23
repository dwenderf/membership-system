'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

interface SyncLog {
  id: string
  operation_type: string
  entity_type: string
  status: string
  error_message?: string
  created_at: string
  response_data?: any
  request_data?: any
}

interface PendingItem {
  id: string
  sync_status: string
  last_synced_at: string
  staging_metadata?: any
  // Invoice-specific fields
  net_amount?: number
  payment_id?: string | null
  // Payment-specific fields
  amount_paid?: number
  reference?: string | null
  xero_invoice_id?: string | null
  // Common user data structure
  payments?: {
    user_id: string
    status?: string
    stripe_payment_intent_id?: string | null
    users: {
      first_name: string | null
      last_name: string | null
      member_id: string | null
    }
  } | null
  xero_invoices?: {
    payment_id: string | null
    payments: {
      user_id: string
      status?: string
      stripe_payment_intent_id?: string | null
      users: {
        first_name: string | null
        last_name: string | null
        member_id: string | null
      }
    } | null
  } | null
}

interface FailedItem {
  id: string
  tenant_id: string
  sync_status: string
  sync_error: string | null
  last_synced_at: string
  staging_metadata?: any
  payment_id?: string | null
  payments?: {
    user_id: string
    users: {
      first_name: string | null
      last_name: string | null
      member_id: string | null
    }
  } | null
  xero_invoice_id?: string | null
  xero_invoices?: {
    payment_id: string | null
    payments: {
      user_id: string
      users: {
        first_name: string | null
        last_name: string | null
        member_id: string | null
      }
    } | null
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
  pending_invoices_list: PendingItem[]
  pending_payments_list: PendingItem[]
  failed_invoices: FailedItem[]
  failed_payments: FailedItem[]
  failed_count: number
}

export default function AccountingIntegrationPage() {
  const [isXeroConnected, setIsXeroConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null)
  const [expandedSyncLogs, setExpandedSyncLogs] = useState<Set<string>>(new Set())
  const [displayedSyncLogs, setDisplayedSyncLogs] = useState<SyncLog[]>([])
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false)
  const [hasMoreLogs, setHasMoreLogs] = useState(true)
  const [selectedTimeWindow, setSelectedTimeWindow] = useState<'24h' | '7d' | '30d'>('24h')
  const [selectedFailedItems, setSelectedFailedItems] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  
  const router = useRouter()
  const { showError, showSuccess } = useToast()

  const fetchXeroStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/xero/status?timeWindow=${selectedTimeWindow}`)
      if (response.ok) {
        const data = await response.json()
        setIsXeroConnected(data.has_active_connection)
        setSyncStats(data.stats)
        // Initialize displayed logs with first 5 items
        const initialLogs = data.stats?.recent_operations?.slice(0, 5) || []
        setDisplayedSyncLogs(initialLogs)
        // Check if there are more logs available
        setHasMoreLogs((data.stats?.recent_operations?.length || 0) > 5)
      } else if (response.status === 401) {
        router.push('/auth/login')
        return
      } else if (response.status === 403) {
        router.push('/dashboard')
        return
      }
    } catch (error) {
      console.error('Error fetching Xero status:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedTimeWindow, router])

  useEffect(() => {
    fetchXeroStatus()
  }, [fetchXeroStatus])

  const loadMoreSyncLogs = async () => {
    if (!syncStats || loadingMoreLogs) return
    
    setLoadingMoreLogs(true)
    try {
      // Calculate offset based on currently displayed logs
      const offset = displayedSyncLogs.length
      
      const response = await fetch(`/api/xero/sync-logs?offset=${offset}&limit=25&timeWindow=${selectedTimeWindow}`)
      if (response.ok) {
        const data = await response.json()
        setDisplayedSyncLogs(prev => [...prev, ...data.logs])
        setHasMoreLogs(data.hasMore)
      } else {
        showError('Failed to load more sync logs')
      }
    } catch (error) {
      console.error('Error loading more sync logs:', error)
      showError('Failed to load more sync logs')
    } finally {
      setLoadingMoreLogs(false)
    }
  }

  const toggleSyncLogExpanded = (logId: string) => {
    const newExpanded = new Set(expandedSyncLogs)
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId)
    } else {
      newExpanded.add(logId)
    }
    setExpandedSyncLogs(newExpanded)
  }

  const handleTimeWindowChange = (timeWindow: '24h' | '7d' | '30d') => {
    setSelectedTimeWindow(timeWindow)
    setDisplayedSyncLogs([])
    setExpandedSyncLogs(new Set())
    setHasMoreLogs(true)
    setLoading(true)
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
        <h1 className="text-2xl font-bold text-gray-900">Accounting Integration</h1>
        <p className="mt-2 text-sm text-gray-600">
          Connect your accounting system to automatically sync invoices and payments
        </p>
      </div>

      <div className="space-y-6">
        {/* Available Integrations */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Integrations</h2>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Xero Integration Card */}
            <div className="border rounded-lg p-4 hover:border-gray-400 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-gray-900">Xero</h3>
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  isXeroConnected 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {isXeroConnected ? 'Connected' : 'Available'}
                </div>
              </div>
              
              <p className="text-sm text-gray-600 mb-4">
                Cloud-based accounting software for small to medium businesses
              </p>
              
              <div className="space-y-2">
                <div className="text-xs text-gray-500">
                  <strong>Features:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Automatic invoice sync</li>
                    <li>• Payment reconciliation</li>
                    <li>• Contact management</li>
                    <li>• Real-time financial data</li>
                  </ul>
                </div>
                
                <div className="pt-2">
                  <Link
                    href="/admin/accounting/xero"
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    {isXeroConnected ? 'Manage Integration' : 'Set Up Xero'}
                  </Link>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Sync Monitoring Sections */}
        {syncStats && (
          <>
            {/* Pending Sync Items */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Pending Sync Items</h2>
                {isXeroConnected && (
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
                )}
              </div>
              
              {!isXeroConnected && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="text-sm text-yellow-800">
                    <Link href="/admin/accounting/xero" className="text-blue-600 hover:text-blue-500 font-medium">
                      Connect to Xero
                    </Link> to enable manual syncing and automatic sync processing
                  </div>
                </div>
              )}

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

              {/* Pending Items List */}
              {syncStats.total_pending > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Pending Items Details</h3>
                  
                  {/* Pending Invoices */}
                  {syncStats.pending_invoices_list.map((item) => {
                    const user = item.payments?.users
                    
                    // Use Xero contact naming convention: "First Last - MemberID"
                    const userDisplayName = user?.first_name && user?.last_name 
                      ? user.member_id 
                        ? `${user.first_name} ${user.last_name} - ${user.member_id}`
                        : `${user.first_name} ${user.last_name}`
                      : 'Unknown User'
                    
                    return (
                      <div key={`pending-inv-${item.id}`} className="flex items-start p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                Invoice
                              </span>
                              <span className="ml-2 text-sm font-medium text-gray-900">
                                {userDisplayName}
                              </span>
                              <span className="ml-2 text-xs text-gray-500 font-mono">
                                ID: {item.id}
                              </span>
                            </div>
                            <time className="text-xs text-gray-500">
                              Staged: {new Date(item.last_synced_at).toLocaleString()}
                            </time>
                          </div>
                          <div className="mt-1 flex items-center space-x-4 text-sm text-gray-600">
                            <span><strong>Status:</strong> {item.sync_status}</span>
                            <span><strong>Amount:</strong> ${(item.net_amount || 0) / 100}</span>
                            {item.payments?.stripe_payment_intent_id && (
                              <span className="text-xs font-mono">
                                <strong>Payment Intent:</strong> {item.payments.stripe_payment_intent_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Pending Payments */}
                  {syncStats.pending_payments_list.map((item) => {
                    const user = item.xero_invoices?.payments?.users
                    
                    // Use Xero contact naming convention: "First Last - MemberID"
                    const userDisplayName = user?.first_name && user?.last_name 
                      ? user.member_id 
                        ? `${user.first_name} ${user.last_name} - ${user.member_id}`
                        : `${user.first_name} ${user.last_name}`
                      : 'Unknown User'
                    
                    return (
                      <div key={`pending-pay-${item.id}`} className="flex items-start p-3 bg-purple-50 rounded-lg border border-purple-200">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                Payment
                              </span>
                              <span className="ml-2 text-sm font-medium text-gray-900">
                                {userDisplayName}
                              </span>
                              <span className="ml-2 text-xs text-gray-500 font-mono">
                                ID: {item.id}
                              </span>
                            </div>
                            <time className="text-xs text-gray-500">
                              Staged: {new Date(item.last_synced_at).toLocaleString()}
                            </time>
                          </div>
                          <div className="mt-1 flex items-center space-x-4 text-sm text-gray-600">
                            <span><strong>Status:</strong> {item.xero_invoices?.payments?.status || 'Unknown'}</span>
                            {item.xero_invoices?.payments?.stripe_payment_intent_id && (
                              <span className="text-xs font-mono">
                                <strong>Payment Intent:</strong> {item.xero_invoices.payments.stripe_payment_intent_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {syncStats.total_pending === 0 && (
                <div className="text-center py-4">
                  <div className="text-green-600 text-sm font-medium">✅ All items are synced to Xero</div>
                  <div className="text-gray-500 text-xs mt-1">The automatic sync service runs every 2 minutes</div>
                </div>
              )}
            </div>

            {/* Sync Activity Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Sync Activity</h2>
                
                {/* Time Window Tabs */}
                <div className="flex rounded-lg border border-gray-200">
                  <button
                    onClick={() => handleTimeWindowChange('24h')}
                    className={`px-3 py-1 text-sm font-medium rounded-l-lg ${
                      selectedTimeWindow === '24h'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-white text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    24h
                  </button>
                  <button
                    onClick={() => handleTimeWindowChange('7d')}
                    className={`px-3 py-1 text-sm font-medium border-l ${
                      selectedTimeWindow === '7d'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-white text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    7d
                  </button>
                  <button
                    onClick={() => handleTimeWindowChange('30d')}
                    className={`px-3 py-1 text-sm font-medium rounded-r-lg border-l ${
                      selectedTimeWindow === '30d'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-white text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    30d
                  </button>
                </div>
              </div>
              
              {!isXeroConnected && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="text-sm text-yellow-800">
                    <Link href="/admin/accounting/xero" className="text-blue-600 hover:text-blue-500 font-medium">
                      Connect to Xero
                    </Link> to enable new sync operations
                  </div>
                </div>
              )}

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

              {displayedSyncLogs && displayedSyncLogs.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Recent Activity</h3>
                  <div className="space-y-2">
                    {displayedSyncLogs.map((log, index) => {
                      const logId = log.id || `log-${index}`
                      const isExpanded = expandedSyncLogs.has(logId)
                      const hasResponseData = log.response_data || log.request_data
                      
                      return (
                        <div key={logId} className="bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between p-3">
                            <div className="flex items-center flex-1">
                              <div className={`w-2 h-2 rounded-full mr-3 ${
                                log.status === 'success' ? 'bg-green-400' : 
                                log.status === 'error' ? 'bg-red-400' : 
                                'bg-yellow-400'
                              }`}></div>
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-900">
                                  {log.operation_type.replace('_', ' ')} - {log.entity_type}
                                </div>
                                {log.error_message && (
                                  <div className="text-xs text-red-600">{log.error_message}</div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {hasResponseData && (
                                <button
                                  onClick={() => toggleSyncLogExpanded(logId)}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  {isExpanded ? 'Hide Details' : 'Show Details'}
                                </button>
                              )}
                              <div className="text-xs text-gray-500">
                                {new Date(log.created_at).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                          
                          {isExpanded && hasResponseData && (
                            <div className="px-3 pb-3 border-t border-gray-200 mt-2">
                              <div className="mt-2 space-y-3">
                                {log.request_data && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-700 mb-1">Request Data:</div>
                                    <pre className="text-xs bg-blue-50 p-2 rounded border overflow-x-auto">
                                      {JSON.stringify(log.request_data, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.response_data && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-700 mb-1">Response Data:</div>
                                    <pre className="text-xs bg-green-50 p-2 rounded border overflow-x-auto">
                                      {JSON.stringify(log.response_data, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Load More Button */}
                  {hasMoreLogs && (
                    <div className="mt-4 text-center">
                      <button
                        onClick={loadMoreSyncLogs}
                        disabled={loadingMoreLogs}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loadingMoreLogs ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Loading...
                          </>
                        ) : (
                          <>
                            <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                            </svg>
                            Load More (25)
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="text-gray-500 text-sm">No sync activity in the selected time window</div>
                </div>
              )}
            </div>

            {/* Failed Sync Items */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Failed Sync Items</h2>
                {syncStats.failed_count > 0 && isXeroConnected && (
                  <div className="flex items-center space-x-2">
                    {selectedFailedItems.size > 0 && (
                      <button
                        onClick={() => handleRetryFailed('selected')}
                        disabled={retrying}
                        className="inline-flex items-center px-3 py-1 border border-orange-300 rounded-md text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {retrying ? 'Retrying...' : `Retry Selected (${selectedFailedItems.size})`}
                      </button>
                    )}
                    <button
                      onClick={handleSelectAllFailed}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {selectedFailedItems.size === syncStats.failed_count ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={() => handleRetryFailed('all')}
                      disabled={retrying}
                      className="inline-flex items-center px-3 py-1 border border-red-300 rounded-md text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {retrying ? 'Retrying...' : 'Retry All'}
                    </button>
                  </div>
                )}
              </div>

              {!isXeroConnected && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="text-sm text-yellow-800">
                    <Link href="/admin/accounting/xero" className="text-blue-600 hover:text-blue-500 font-medium">
                      Connect to Xero
                    </Link> to retry failed sync items
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
                <div className="bg-red-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{syncStats.failed_invoices.length}</div>
                  <div className="text-sm text-red-800">Failed Invoices</div>
                </div>
                <div className="bg-red-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{syncStats.failed_payments.length}</div>
                  <div className="text-sm text-red-800">Failed Payments</div>
                </div>
              </div>

              {syncStats.failed_count > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Failed Items Details</h3>
                  
                  {/* Failed Invoices */}
                  {syncStats.failed_invoices.map((item) => {
                    const user = item.payments?.users
                    const itemKey = `inv_${item.id}`
                    const isSelected = selectedFailedItems.has(itemKey)
                    
                    // Use Xero contact naming convention: "First Last - MemberID"
                    const userDisplayName = user?.first_name && user?.last_name 
                      ? user.member_id 
                        ? `${user.first_name} ${user.last_name} - ${user.member_id}`
                        : `${user.first_name} ${user.last_name}`
                      : 'Unknown User'
                    
                    return (
                      <div key={`failed-inv-${item.id}`} className="flex items-start p-3 bg-red-50 rounded-lg border border-red-200">
                        <div className="flex items-center mr-3 mt-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleFailedItemToggle(itemKey)}
                            disabled={!isXeroConnected}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                Invoice
                              </span>
                              <span className="ml-2 text-sm font-medium text-gray-900">
                                {userDisplayName}
                              </span>
                              <span className="ml-2 text-xs text-gray-500 font-mono">
                                ID: {item.id}
                              </span>
                            </div>
                            <time className="text-xs text-gray-500">
                              Failed: {new Date(item.last_synced_at).toLocaleString()}
                            </time>
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            <span><strong>Status:</strong> {item.sync_status}</span>
                            {item.sync_error && (
                              <div className="mt-1 text-xs text-red-600 bg-red-100 p-2 rounded">
                                <strong>Error:</strong> {item.sync_error}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Failed Payments */}
                  {syncStats.failed_payments.map((item) => {
                    const user = item.xero_invoices?.payments?.users
                    const itemKey = `pay_${item.id}`
                    const isSelected = selectedFailedItems.has(itemKey)
                    
                    // Use Xero contact naming convention: "First Last - MemberID"
                    const userDisplayName = user?.first_name && user?.last_name 
                      ? user.member_id 
                        ? `${user.first_name} ${user.last_name} - ${user.member_id}`
                        : `${user.first_name} ${user.last_name}`
                      : 'Unknown User'
                    
                    return (
                      <div key={`failed-pay-${item.id}`} className="flex items-start p-3 bg-red-50 rounded-lg border border-red-200">
                        <div className="flex items-center mr-3 mt-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleFailedItemToggle(itemKey)}
                            disabled={!isXeroConnected}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                Payment
                              </span>
                              <span className="ml-2 text-sm font-medium text-gray-900">
                                {userDisplayName}
                              </span>
                              <span className="ml-2 text-xs text-gray-500 font-mono">
                                ID: {item.id}
                              </span>
                            </div>
                            <time className="text-xs text-gray-500">
                              Failed: {new Date(item.last_synced_at).toLocaleString()}
                            </time>
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            <span><strong>Status:</strong> {item.sync_status}</span>
                            {item.sync_error && (
                              <div className="mt-1 text-xs text-red-600 bg-red-100 p-2 rounded">
                                <strong>Error:</strong> {item.sync_error}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="text-green-600 text-sm font-medium">✅ No failed sync items</div>
                  <div className="text-gray-500 text-xs mt-1">All sync operations completed successfully</div>
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* Return to Admin Link */}
      <div className="mt-6">
        <Link 
          href="/admin"
          className="text-blue-600 hover:text-blue-500 text-sm font-medium"
        >
          ← Back to Admin Dashboard
        </Link>
      </div>
    </div>
  )
}