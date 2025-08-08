import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatAmount } from '@/lib/invoice-utils'
import { Logger } from '@/lib/logging/logger'

interface PageProps {
  params: {
    id: string
    invoiceId: string
  }
}

export default async function AdminUserInvoiceDetailPage({ params }: PageProps) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  // Fetch user details
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('first_name, last_name, email')
    .eq('id', params.id)
    .single()

  if (userError || !user) {
    logger.logSystem('admin-invoice-user-error', 'Error fetching user for invoice detail', { 
      userId: params.id,
      error: userError?.message 
    })
    redirect('/admin/reports/users')
  }

  // This would need to be implemented to fetch invoice details from Xero
  // For now, we'll show a placeholder
  const invoice = null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <Link 
              href={`/admin/reports/users/${params.id}`}
              className="text-blue-600 hover:text-blue-500 text-sm font-medium mb-4 inline-block"
            >
              ← Back to User Details
            </Link>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Invoice Details</h1>
                <p className="text-gray-600 mt-1">
                  Invoice for {user.first_name} {user.last_name} ({user.email})
                </p>
              </div>
              {/* Refund button placeholder */}
              <div className="flex space-x-3">
                <button
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  disabled
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m5 5v1a4 4 0 01-4 4H8m0 0l3-3m-3 3l3 3"></path>
                  </svg>
                  Process Refund
                </button>
              </div>
            </div>
          </div>

          {invoice ? (
            <div className="space-y-6">
              {/* Invoice details would go here */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Invoice Information</h3>
                <p className="text-gray-600">Invoice details would be displayed here.</p>
              </div>

              {/* Refund History Section */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Refund History</h3>
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No refunds have been processed for this invoice.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Invoice Not Found</h3>
              <p className="text-gray-600 mb-4">
                The requested invoice could not be found or is not accessible.
              </p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">
                      Invoice Integration Not Available
                    </h3>
                    <div className="mt-2 text-sm text-yellow-700">
                      <p>
                        Invoice details will be available once the Xero integration is fully implemented. 
                        This feature will show detailed invoice information, line items, and payment history.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <Link
                href={`/admin/reports/users/${params.id}`}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                Back to User Details
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
