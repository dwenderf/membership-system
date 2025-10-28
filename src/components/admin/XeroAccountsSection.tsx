'use client'

import { useState, useEffect, useMemo } from 'react'
import { useToast } from '@/contexts/ToastContext'
import SyncStatus from './SyncStatus'

interface XeroAccount {
  code: string
  name: string
  type: string
  description?: string
  inUse: boolean
}

interface XeroAccountsData {
  accounts: XeroAccount[]
  lastSyncedAt: string | null
  totalCount: number
}

/**
 * Collapsible Xero Accounts Section
 *
 * Shows all synced Xero chart of accounts with:
 * - Search functionality
 * - Type filtering
 * - "In Use" indicator
 * - Manual sync button
 * - Last sync timestamp
 * - Pagination
 */
export default function XeroAccountsSection() {
  const [isOpen, setIsOpen] = useState(false)
  const [accounts, setAccounts] = useState<XeroAccount[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [inUseFilter, setInUseFilter] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20

  const { showError, showSuccess } = useToast()

  // Fetch accounts when section is opened
  useEffect(() => {
    if (isOpen && accounts.length === 0) {
      fetchAccounts()
    }
  }, [isOpen, accounts.length])

  // Memoized filtered accounts - only recalculate when dependencies change
  const filteredAccounts = useMemo(() => {
    let filtered = accounts

    // Search filter
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase()
      filtered = filtered.filter(
        account =>
          account.code.toLowerCase().includes(lowerSearch) ||
          account.name.toLowerCase().includes(lowerSearch)
      )
    }

    // Type filter
    if (typeFilter) {
      filtered = filtered.filter(account => account.type === typeFilter)
    }

    // In Use filter
    if (inUseFilter) {
      filtered = filtered.filter(account => account.inUse)
    }

    return filtered
  }, [accounts, searchTerm, typeFilter, inUseFilter])

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, typeFilter, inUseFilter])

  const fetchAccounts = async () => {
    setLoading(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/xero/accounts')
      if (response.ok) {
        const data: XeroAccountsData = await response.json()
        setAccounts(data.accounts)
        setLastSyncedAt(data.lastSyncedAt)
        setTotalCount(data.totalCount)
      } else {
        setSyncError('Failed to load accounts')
      }
    } catch (error) {
      console.error('Failed to fetch Xero accounts:', error)
      setSyncError('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/admin/sync-xero-accounts', { method: 'POST' })
      if (response.ok) {
        const data = await response.json()
        showSuccess(`Synced ${data.totalAccounts} accounting codes successfully`)
        await fetchAccounts() // Refresh the list
      } else {
        const errorData = await response.json()
        setSyncError(errorData.error || 'Sync failed')
        showError(errorData.error || 'Failed to sync accounting codes')
      }
    } catch (error) {
      setSyncError('Sync failed')
      showError('Failed to sync accounting codes')
    } finally {
      setSyncing(false)
    }
  }

  // Get unique account types for filter dropdown
  const accountTypes = Array.from(new Set(accounts.map(a => a.type))).sort()

  // Pagination
  const totalPages = Math.ceil(filteredAccounts.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedAccounts = filteredAccounts.slice(startIndex, endIndex)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 text-lg font-semibold hover:text-blue-600"
          >
            <svg
              className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Xero Chart of Accounts
          </button>
          <p className="text-sm text-gray-600 mt-1 ml-7">
            View and search all synced Xero accounting codes
          </p>
        </div>

        {/* Sync button and status */}
        <div className="flex items-center gap-4">
          <SyncStatus
            lastSyncedAt={lastSyncedAt}
            itemCount={totalCount}
            loading={syncing}
            error={syncError}
          />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Collapsible content */}
      {isOpen && (
        <div className="mt-4 border-t pt-4">
          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by code or name..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>

            {/* Type filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Account Type
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">All Types</option>
                {accountTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* In Use filter */}
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inUseFilter}
                  onChange={(e) => setInUseFilter(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Show only codes in use
                </span>
              </label>
            </div>
          </div>

          {/* Accounts table */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading accounts...</p>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {accounts.length === 0 ? 'No accounts synced yet. Click "Sync Now" to load accounts.' : 'No accounts found matching your filters.'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Code
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedAccounts.map((account) => (
                      <tr key={account.code} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {account.code}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {account.name}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {account.type}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {account.inUse ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              In Use
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                              Not Used
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-gray-700">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredAccounts.length)} of{' '}
                    {filteredAccounts.length} accounts
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-700">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
