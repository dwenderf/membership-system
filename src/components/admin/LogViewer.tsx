'use client'

/**
 * Admin Log Viewer Component
 *
 * Displays database logs from email_logs, email_change_logs, and xero_sync_logs tables
 */

import { useState, useEffect } from 'react'

type LogType = 'email_logs' | 'email_change_logs' | 'xero_sync_logs'

interface LogFilters {
  logType: LogType
  limit: number
}

interface LogResponse {
  logs: any[]
  logType: LogType
  total: number
  limit: number
  error?: string
}

export default function LogViewer() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filters, setFilters] = useState<LogFilters>({
    logType: 'email_logs',
    limit: 100
  })

  // Load logs
  const loadLogs = async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        logType: filters.logType,
        limit: filters.limit.toString()
      })

      const response = await fetch(`/api/admin/logs?${params}`)

      if (!response.ok) {
        throw new Error('Failed to load logs')
      }

      const data: LogResponse = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      setLogs(data.logs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Filter logs by search term
  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true
    const searchLower = searchTerm.toLowerCase()
    // Search across all string fields
    return Object.values(log).some(value =>
      String(value).toLowerCase().includes(searchLower)
    )
  })

  // Load data on mount and filter changes
  useEffect(() => {
    loadLogs()
  }, [filters])

  // Get human-readable log type name
  const getLogTypeName = (logType: LogType) => {
    const names = {
      'email_logs': '📧 Emails Sent',
      'email_change_logs': '✉️ Email Changes',
      'xero_sync_logs': '📊 Xero Sync'
    }
    return names[logType]
  }

  // Render field value with appropriate formatting
  const renderFieldValue = (key: string, value: any) => {
    // Null/undefined
    if (value === null || value === undefined) {
      return <span className="text-gray-400 italic">null</span>
    }

    // Boolean
    if (typeof value === 'boolean') {
      return (
        <span className={value ? 'text-green-600' : 'text-red-600'}>
          {value ? '✓ true' : '✗ false'}
        </span>
      )
    }

    // Date/timestamp fields
    if (key.includes('_at') || key.includes('_date')) {
      try {
        const date = new Date(value)
        if (!isNaN(date.getTime())) {
          return (
            <span className="text-gray-700">
              {date.toLocaleString()}
            </span>
          )
        }
      } catch {
        // Fall through to default
      }
    }

    // JSONB fields (objects/arrays) - make expandable
    if (typeof value === 'object') {
      return (
        <details className="inline">
          <summary className="text-blue-600 cursor-pointer hover:text-blue-800">
            {Array.isArray(value) ? `[${value.length} items]` : '{object}'}
          </summary>
          <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-x-auto border">
            {JSON.stringify(value, null, 2)}
          </pre>
        </details>
      )
    }

    // Status fields - color-coded
    if (key === 'status') {
      const statusColors: Record<string, string> = {
        'success': 'bg-green-100 text-green-800 border-green-200',
        'sent': 'bg-green-100 text-green-800 border-green-200',
        'delivered': 'bg-blue-100 text-blue-800 border-blue-200',
        'pending': 'bg-yellow-100 text-yellow-800 border-yellow-200',
        'error': 'bg-red-100 text-red-800 border-red-200',
        'failed': 'bg-red-100 text-red-800 border-red-200',
        'warning': 'bg-orange-100 text-orange-800 border-orange-200',
        'bounced': 'bg-purple-100 text-purple-800 border-purple-200',
        'spam': 'bg-gray-100 text-gray-800 border-gray-200'
      }
      const colorClass = statusColors[value] || 'bg-gray-100 text-gray-800 border-gray-200'
      return (
        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded border ${colorClass}`}>
          {value}
        </span>
      )
    }

    // Default: string or number
    return <span className="text-gray-700">{String(value)}</span>
  }

  // Get displayable fields (exclude internal/redundant fields)
  const getDisplayFields = (log: any) => {
    const excludeFields = ['id']
    return Object.keys(log).filter(key => !excludeFields.includes(key))
  }

  // Format field name for display
  const formatFieldName = (key: string) => {
    return key
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">
          {getLogTypeName(filters.logType)}
        </h2>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Filters</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Log Type</label>
            <select
              value={filters.logType}
              onChange={(e) => {
                setFilters(prev => ({ ...prev, logType: e.target.value as LogType }))
                setSearchTerm('') // Clear search when switching log types
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="email_logs">📧 Emails Sent</option>
              <option value="email_change_logs">✉️ Email Changes</option>
              <option value="xero_sync_logs">📊 Xero Sync</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Limit</label>
            <select
              value={filters.limit}
              onChange={(e) => setFilters(prev => ({ ...prev, limit: parseInt(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value={50}>50 entries</option>
              <option value={100}>100 entries</option>
              <option value={200}>200 entries</option>
              <option value={500}>500 entries</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-red-800">Error: {error}</div>
        </div>
      )}

      {/* Log Entries */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">
            Log Entries ({filteredLogs.length})
          </h3>
        </div>

        <div className="divide-y divide-gray-200">
          {filteredLogs.map((log, index) => {
            const displayFields = getDisplayFields(log)

            return (
              <div key={log.id || index} className="p-4 hover:bg-gray-50">
                <div className="space-y-2">
                  {displayFields.map(key => (
                    <div key={key} className="grid grid-cols-4 gap-4">
                      <div className="col-span-1 text-sm font-medium text-gray-500">
                        {formatFieldName(key)}:
                      </div>
                      <div className="col-span-3 text-sm">
                        {renderFieldValue(key, log[key])}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {filteredLogs.length === 0 && !loading && (
            <div className="p-8 text-center text-gray-500">
              No logs found.
            </div>
          )}

          {loading && (
            <div className="p-8 text-center text-gray-500">
              Loading logs...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
