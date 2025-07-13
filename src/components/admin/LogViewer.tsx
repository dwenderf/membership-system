'use client'

/**
 * Admin Log Viewer Component
 * 
 * Provides a comprehensive interface for viewing and filtering application logs
 */

import { useState, useEffect } from 'react'
import { LogEntry, LogLevel, LogCategory } from '@/lib/logging/logger'

interface LogStats {
  totalEntries: number
  entriesByLevel: Record<LogLevel, number>
  entriesByCategory: Record<LogCategory, number>
  oldestEntry?: string
  newestEntry?: string
}

interface LogResponse {
  logs: LogEntry[]
  filters: any
  total: number
  serverless?: boolean
  message?: string
}

interface LogFilters {
  category: LogCategory | 'all'
  level: LogLevel | 'all'
  startDate: string
  endDate: string
  limit: number
}

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [isServerless, setIsServerless] = useState(false)
  const [serverlessMessage, setServerlessMessage] = useState('')
  const [filters, setFilters] = useState<LogFilters>({
    category: 'all',
    level: 'all',
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Yesterday
    endDate: new Date().toISOString().split('T')[0], // Today
    limit: 100
  })

  // Load logs
  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const params = new URLSearchParams({
        action: 'logs',
        limit: filters.limit.toString(),
        startDate: filters.startDate + 'T00:00:00.000Z',
        endDate: filters.endDate + 'T23:59:59.999Z'
      })
      
      if (filters.category !== 'all') params.set('category', filters.category)
      if (filters.level !== 'all') params.set('level', filters.level)
      
      const response = await fetch(`/api/admin/logs?${params}`)
      
      if (!response.ok) {
        throw new Error('Failed to load logs')
      }
      
      const data: LogResponse = await response.json()
      setLogs(data.logs)
      
      if (data.serverless) {
        setIsServerless(true)
        setServerlessMessage(data.message || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Load stats
  const loadStats = async () => {
    try {
      const response = await fetch('/api/admin/logs?action=stats')
      
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats)
      }
    } catch (err) {
      console.error('Failed to load log stats:', err)
    }
  }

  // Filter logs by search term
  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      log.message.toLowerCase().includes(searchLower) ||
      log.operation.toLowerCase().includes(searchLower) ||
      JSON.stringify(log.metadata || {}).toLowerCase().includes(searchLower)
    )
  })

  // Load data on mount and filter changes
  useEffect(() => {
    loadLogs()
    loadStats()
  }, [filters])

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return
    
    const interval = setInterval(() => {
      loadLogs()
      loadStats()
    }, 5000) // Refresh every 5 seconds
    
    return () => clearInterval(interval)
  }, [autoRefresh, filters])

  // Log level styling
  const getLevelStyle = (level: LogLevel) => {
    const styles = {
      debug: 'bg-gray-100 text-gray-700 border-gray-300',
      info: 'bg-blue-100 text-blue-700 border-blue-300',
      warn: 'bg-yellow-100 text-yellow-700 border-yellow-300',
      error: 'bg-red-100 text-red-700 border-red-300'
    }
    return styles[level]
  }

  // Category styling
  const getCategoryIcon = (category: LogCategory) => {
    const icons = {
      'payment-processing': '💳',
      'xero-sync': '📊',
      'batch-processing': '📦',
      'service-management': '⚙️',
      'admin-action': '👨‍💼',
      'system': '🖥️'
    }
    return icons[category]
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Application Logs</h1>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-600">Auto-refresh</span>
          </label>
          <button
            onClick={() => { loadLogs(); loadStats(); }}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-2xl font-bold text-blue-600">{stats.totalEntries}</div>
            <div className="text-sm text-gray-600">Total Entries</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-2xl font-bold text-red-600">{stats.entriesByLevel.error}</div>
            <div className="text-sm text-gray-600">Errors</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-2xl font-bold text-yellow-600">{stats.entriesByLevel.warn}</div>
            <div className="text-sm text-gray-600">Warnings</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-2xl font-bold text-green-600">{stats.entriesByLevel.info}</div>
            <div className="text-sm text-gray-600">Info</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={filters.category}
              onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value as LogCategory | 'all' }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="all">All Categories</option>
              <option value="payment-processing">💳 Payment Processing</option>
              <option value="xero-sync">📊 Xero Sync</option>
              <option value="batch-processing">📦 Batch Processing</option>
              <option value="service-management">⚙️ Service Management</option>
              <option value="admin-action">👨‍💼 Admin Actions</option>
              <option value="system">🖥️ System</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
            <select
              value={filters.level}
              onChange={(e) => setFilters(prev => ({ ...prev, level: e.target.value as LogLevel | 'all' }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="all">All Levels</option>
              <option value="debug">🐛 Debug</option>
              <option value="info">ℹ️ Info</option>
              <option value="warn">⚠️ Warning</option>
              <option value="error">❌ Error</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
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
              <option value={500}>500 entries</option>
              <option value={1000}>1000 entries</option>
            </select>
          </div>
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

      {/* Serverless Environment Notice */}
      {isServerless && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-blue-400 text-xl">☁️</span>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                Serverless Environment Detected
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <p>{serverlessMessage}</p>
                <p className="mt-2">
                  <strong>Console logs are still working!</strong> Check your terminal during development 
                  or visit your <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" 
                  className="underline hover:text-blue-900">Vercel Dashboard → Functions → Logs</a> for production logs.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-red-800">Error: {error}</div>
        </div>
      )}

      {/* Log Entries */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">
            Log Entries ({filteredLogs.length})
          </h2>
        </div>
        
        <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
          {filteredLogs.map((log, index) => (
            <div key={index} className="p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <span className="text-lg">{getCategoryIcon(log.category)}</span>
                    <span className={`px-2 py-1 text-xs font-medium rounded border ${getLevelStyle(log.level)}`}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{log.operation}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-700 mb-2">
                    {log.message}
                  </div>
                  
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <details className="text-xs">
                      <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                        Metadata
                      </summary>
                      <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {filteredLogs.length === 0 && !loading && (
            <div className="p-8 text-center text-gray-500">
              No logs found matching the current filters.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}