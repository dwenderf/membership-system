import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AccountingIntegrationPage() {
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

  // Check if Xero is connected by looking for active OAuth tokens
  const { data: xeroTokens } = await supabase
    .from('xero_oauth_tokens')
    .select('*')
    .eq('is_active', true)

  const isXeroConnected = xeroTokens && xeroTokens.length > 0

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

        {/* Quick Actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/admin/accounting-codes"
              className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-4 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <div className="text-gray-900 font-medium text-sm">Accounting Codes</div>
              <div className="mt-1 text-xs text-gray-500">Manage default codes for sync</div>
            </Link>
            
            {isXeroConnected && (
              <Link
                href="/admin/accounting/xero/sync-status"
                className="relative block w-full border-2 border-gray-300 border-dashed rounded-lg p-4 text-center hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <div className="text-gray-900 font-medium text-sm">Sync Status</div>
                <div className="mt-1 text-xs text-gray-500">View recent sync activity</div>
              </Link>
            )}
          </div>
        </div>
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