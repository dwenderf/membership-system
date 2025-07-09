import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function XeroIntegrationPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!userProfile?.is_admin) {
    redirect('/dashboard')
  }

  // Check if Xero is connected and get token details
  const { data: xeroTokens } = await supabase
    .from('xero_oauth_tokens')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const isXeroConnected = xeroTokens && xeroTokens.length > 0
  const currentToken = xeroTokens?.[0]

  // Get recent sync activity
  const { data: recentSyncLogs } = await supabase
    .from('xero_sync_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  // Get sync stats
  const { data: syncStats } = await supabase
    .from('xero_sync_logs')
    .select('status')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours

  const successfulSyncs = syncStats?.filter(log => log.status === 'success').length || 0
  const errorSyncs = syncStats?.filter(log => log.status === 'error').length || 0

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
                      Organization: {currentToken?.tenant_name}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-green-600">
                  Connected {new Date(currentToken?.created_at || '').toLocaleDateString()}
                </div>
              </div>

              {/* Token expiry warning */}
              {currentToken?.expires_at && new Date(currentToken.expires_at) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center">
                    <svg className="h-5 w-5 text-yellow-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <h3 className="text-sm font-medium text-yellow-800">Token Expiring Soon</h3>
                      <p className="text-sm text-yellow-700">
                        Your Xero token expires on {new Date(currentToken.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
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
                    Connect to Xero to enable automatic syncing of invoices and payments
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sync Activity (only show if connected) */}
        {isXeroConnected && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Sync Activity (Last 24 Hours)</h2>
            
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{successfulSyncs}</div>
                <div className="text-sm text-green-800">Successful Syncs</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{errorSyncs}</div>
                <div className="text-sm text-red-800">Failed Syncs</div>
              </div>
            </div>

            {recentSyncLogs && recentSyncLogs.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Recent Activity</h3>
                <div className="space-y-2">
                  {recentSyncLogs.slice(0, 3).map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
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
        )}

        {/* Management Actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Management</h2>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {isXeroConnected ? (
              <>
                <Link
                  href="/admin/accounting/xero/sync-status"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-4 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium text-sm">View Sync Logs</div>
                  <div className="mt-1 text-xs text-gray-500">Detailed sync history and errors</div>
                </Link>

                <Link
                  href="/admin/accounting/xero/settings"
                  className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-4 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="text-gray-900 font-medium text-sm">Sync Settings</div>
                  <div className="mt-1 text-xs text-gray-500">Configure sync preferences</div>
                </Link>

                <button className="relative block w-full border-2 border-red-300 border-dashed rounded-lg p-4 text-center hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
                  <div className="text-red-900 font-medium text-sm">Disconnect</div>
                  <div className="mt-1 text-xs text-red-500">Remove Xero connection</div>
                </button>
              </>
            ) : (
              <div className="col-span-full">
                <div className="text-center">
                  <Link
                    href="/admin/accounting/xero/connect"
                    className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Connect to Xero
                  </Link>
                </div>
                
                <div className="mt-6 bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Before connecting:</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Ensure you have admin access to your Xero organization</li>
                    <li>• Set up your accounting codes in the <Link href="/admin/accounting-codes" className="text-blue-600 hover:text-blue-500">accounting codes page</Link></li>
                    <li>• Review your chart of accounts in Xero</li>
                  </ul>
                </div>
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
    </div>
  )
}