'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type TabType = 'auth' | 'email' | 'oauth'

const recordLimits = [
  { label: 'Last 250', value: '250' },
  { label: 'Last 500', value: '500' },
  { label: 'Last 1000', value: '1000' }
]

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

interface OAuthMismatch {
  id: string
  account_email: string
  oauth_email: string
  first_name: string | null
  last_name: string | null
  last_sign_in_at: string
  providers: string[]
}

function SecurityContent() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>(
    (searchParams.get('tab') as TabType) || 'auth'
  )
  const [authLogs, setAuthLogs] = useState<AuthLog[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])
  const [oauthMismatches, setOauthMismatches] = useState<OAuthMismatch[]>([])
  const [oauthCount, setOauthCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Client-side search filter and record limit
  const [searchFilter, setSearchFilter] = useState('')
  const [selectedLimit, setSelectedLimit] = useState('250')
  const [offset] = useState(0)

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true)
      setError(null)

      try {
        const limit = parseInt(selectedLimit)

        if (activeTab === 'auth') {
          const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString()
          })

          const response = await fetch(`/api/admin/security/auth-logs?${params}`)
          const data = await response.json()

          if (response.ok) {
            setAuthLogs(data.logs || [])
          } else {
            setError(data.error || 'Failed to fetch auth logs')
          }
        } else if (activeTab === 'email') {
          const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString()
          })

          const response = await fetch(`/api/admin/security/email-logs?${params}`)
          const data = await response.json()

          if (response.ok) {
            setEmailLogs(data.logs || [])
          } else {
            setError(data.error || 'Failed to fetch email logs')
          }
        } else if (activeTab === 'oauth') {
          const response = await fetch('/api/admin/security/oauth-mismatches')
          const data = await response.json()

          if (response.ok) {
            setOauthMismatches(data.mismatches || [])
            setOauthCount(data.count || 0)
          } else {
            setError(data.error || 'Failed to fetch OAuth mismatches')
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
  }, [activeTab, selectedLimit, offset])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  // Client-side search filtering only (record limiting is done server-side)
  const filteredAuthLogs = authLogs.filter((log) => {
    if (!searchFilter) return true
    const search = searchFilter.toLowerCase()
    return (
      log.email?.toLowerCase().includes(search) ||
      log.first_name?.toLowerCase().includes(search) ||
      log.last_name?.toLowerCase().includes(search) ||
      `${log.first_name} ${log.last_name}`.toLowerCase().includes(search)
    )
  })

  const filteredEmailLogs = emailLogs.filter((log) => {
    if (!searchFilter) return true
    const search = searchFilter.toLowerCase()
    return (
      log.users.email?.toLowerCase().includes(search) ||
      log.users.first_name?.toLowerCase().includes(search) ||
      log.users.last_name?.toLowerCase().includes(search) ||
      `${log.users.first_name} ${log.users.last_name}`.toLowerCase().includes(search) ||
      log.old_email?.toLowerCase().includes(search) ||
      log.new_email?.toLowerCase().includes(search)
    )
  })

  const filteredOauthMismatches = oauthMismatches.filter((mismatch) => {
    if (!searchFilter) return true
    const search = searchFilter.toLowerCase()
    return (
      mismatch.account_email?.toLowerCase().includes(search) ||
      mismatch.oauth_email?.toLowerCase().includes(search) ||
      mismatch.first_name?.toLowerCase().includes(search) ||
      mismatch.last_name?.toLowerCase().includes(search) ||
      `${mismatch.first_name} ${mismatch.last_name}`.toLowerCase().includes(search)
    )
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security & Audit Logs</h1>
      </div>

      {/* Record Limit Buttons - only show for auth and email tabs */}
      {activeTab !== 'oauth' && (
        <div className="flex space-x-1 mb-6">
          {recordLimits.map((limit) => (
            <button
              key={limit.value}
              onClick={() => setSelectedLimit(limit.value)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                selectedLimit === limit.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {limit.label}
            </button>
          ))}
        </div>
      )}

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
          <button
            onClick={() => setActiveTab('oauth')}
            className={`${
              activeTab === 'oauth'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2`}
          >
            Email/OAuth Mismatches
            {oauthCount > 0 && (
              <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                {oauthCount}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Search */}
      <div className="mb-6 flex gap-4">
        <div>
          <label htmlFor="searchFilter" className="block text-sm font-medium text-gray-700 mb-1">
            Search by Name or Email
          </label>
          <input
            type="text"
            id="searchFilter"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search users..."
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 w-64"
          />
          {searchFilter && (
            <p className="mt-1 text-xs text-gray-500">
              {activeTab === 'auth'
                ? `Showing ${filteredAuthLogs.length} of ${authLogs.length} logs`
                : activeTab === 'email'
                ? `Showing ${filteredEmailLogs.length} of ${emailLogs.length} logs`
                : `Showing ${filteredOauthMismatches.length} of ${oauthCount} mismatches`
              }
            </p>
          )}
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
          {activeTab === 'auth' && (
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
                {filteredAuthLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    {searchFilter ? 'No logs match your search' : 'No authentication logs found'}
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
                        {filteredAuthLogs.map((log) => (
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
          )}

          {activeTab === 'email' && (
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
                {filteredEmailLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    {searchFilter ? 'No logs match your search' : 'No email change logs found'}
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
                        {filteredEmailLogs.map((log) => (
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

          {activeTab === 'oauth' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Email/OAuth Mismatches
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Users where account email differs from Google OAuth email
                </p>
              </div>
              <div className="border-t border-gray-200">
                {filteredOauthMismatches.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    {searchFilter ? 'No mismatches match your search' : 'No email/OAuth mismatches found'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            User
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Account Email
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Google OAuth Email
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Last Sign In
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Providers
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredOauthMismatches.map((mismatch) => (
                          <tr key={mismatch.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {mismatch.first_name && mismatch.last_name ? (
                                `${mismatch.first_name} ${mismatch.last_name}`
                              ) : (
                                'N/A'
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {mismatch.account_email}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {mismatch.oauth_email}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {mismatch.last_sign_in_at ? formatDate(mismatch.last_sign_in_at) : 'Never'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {mismatch.providers.join(', ')}
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

      {/* Return to Admin Link */}
      <div className="mt-6">
        <a
          href="/admin"
          className="text-blue-600 hover:text-blue-500 text-sm font-medium"
        >
          ← Back to Admin Dashboard
        </a>
      </div>
    </div>
  )
}

export default function AdminSecurityPage() {
  return (
    <Suspense fallback={
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Security & Audit Logs</h1>
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SecurityContent />
    </Suspense>
  )
}
