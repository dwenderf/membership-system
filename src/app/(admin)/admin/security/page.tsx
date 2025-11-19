'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type TabType = 'auth' | 'email'

interface AuthLog {
  id: string
  created_at: string
  ip_address: string | null
  user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  action: string
  payload: any
}

interface EmailLog {
  id: string
  created_at: string
  user_id: string
  old_email: string
  new_email: string | null
  event_type: string
  ip_address: string | null
  user_agent: string | null
  metadata: any
  users: {
    id: string
    first_name: string
    last_name: string
    email: string
  }
}

function SecurityContent() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>(
    (searchParams.get('tab') as TabType) || 'auth'
  )
  const [authLogs, setAuthLogs] = useState<AuthLog[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [userIdFilter, setUserIdFilter] = useState(searchParams.get('user') || '')
  const [limit] = useState(50)
  const [offset] = useState(0)

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true)
      setError(null)

      try {
        if (activeTab === 'auth') {
          const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
          })
          if (userIdFilter) params.append('user_id', userIdFilter)

          const response = await fetch(`/api/admin/security/auth-logs?${params}`)
          const data = await response.json()

          if (response.ok) {
            setAuthLogs(data.logs || [])
          } else {
            setError(data.error || 'Failed to fetch auth logs')
          }
        } else {
          const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
          })
          if (userIdFilter) params.append('user_id', userIdFilter)

          const response = await fetch(`/api/admin/security/email-logs?${params}`)
          const data = await response.json()

          if (response.ok) {
            setEmailLogs(data.logs || [])
          } else {
            setError(data.error || 'Failed to fetch email logs')
          }
        }
      } catch (err) {
        console.error('Error fetching logs:', err)
        setError('An unexpected error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [activeTab, userIdFilter, limit, offset])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-4">
        <ol className="flex items-center space-x-2 text-sm">
          <li>
            <a href="/admin" className="text-blue-600 hover:text-blue-800">
              Admin Dashboard
            </a>
          </li>
          <li className="text-gray-400">/</li>
          <li className="text-gray-600">Security Logs</li>
        </ol>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Security & Audit Logs</h1>
        <p className="mt-2 text-sm text-gray-600">
          Monitor authentication attempts and email change activity
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('auth')}
            className={`${
              activeTab === 'auth'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Authentication Logs
          </button>
          <button
            onClick={() => setActiveTab('email')}
            className={`${
              activeTab === 'email'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Email Change Logs
          </button>
        </nav>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <div>
          <label htmlFor="userFilter" className="block text-sm font-medium text-gray-700 mb-1">
            Filter by User ID
          </label>
          <input
            type="text"
            id="userFilter"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="Enter user ID..."
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading logs...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      ) : (
        <>
          {activeTab === 'auth' ? (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Authentication Activity
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  All authentication events from Supabase Auth
                </p>
              </div>
              <div className="border-t border-gray-200">
                {authLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    No authentication logs found
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Timestamp
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            User
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Action
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            IP Address
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {authLogs.map((log) => (
                          <tr key={log.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {formatDate(log.created_at)}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {log.first_name && log.last_name ? (
                                <>
                                  {log.first_name} {log.last_name}
                                  <br />
                                  <span className="text-xs text-gray-500">{log.email || 'N/A'}</span>
                                </>
                              ) : (
                                log.email || 'N/A'
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {log.action || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {log.ip_address || 'Not captured'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Email Change Activity
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  All email change requests and confirmations
                </p>
              </div>
              <div className="border-t border-gray-200">
                {emailLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    No email change logs found
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Timestamp
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            User
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Event
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Email Change
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            IP Address
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {emailLogs.map((log) => (
                          <tr key={log.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {formatDate(log.created_at)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {log.users.first_name} {log.users.last_name}
                              <br />
                              <span className="text-xs text-gray-500">{log.users.email}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                log.event_type.includes('failed') || log.event_type.includes('rate_limit')
                                  ? 'bg-red-100 text-red-800'
                                  : log.event_type.includes('succeeded') || log.event_type === 'email_updated'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {log.event_type}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {log.old_email}
                              {log.new_email && (
                                <>
                                  <br />
                                  <span className="text-gray-500">→ {log.new_email}</span>
                                </>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {log.ip_address || 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function AdminSecurityPage() {
  return (
    <Suspense fallback={
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Security & Audit Logs</h1>
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SecurityContent />
    </Suspense>
  )
}
