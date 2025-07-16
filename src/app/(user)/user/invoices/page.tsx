import { createClient } from '@/lib/supabase/server'
import { formatAmount, getInvoiceDueDate, isInvoiceOverdue, getDaysUntilDue } from '@/lib/invoice-utils'
import { getOrganizationName } from '@/lib/organization'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function UserInvoicesPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  // Check if Xero is connected
  const { data: xeroStatus } = await supabase
    .from('xero_oauth_tokens')
    .select('tenant_id, tenant_name, expires_at')
    .eq('is_active', true)
    .single()

  if (!xeroStatus) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
            <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Invoices Not Available</h3>
          <p className="text-gray-600 mb-4">
            Invoice information is not currently available. Please contact a system administrator for more information.
          </p>
          <Link
            href="/user"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // Fetch invoices from Xero API
  let invoices: any[] = []
  let unpaidCount = 0
  let unpaidTotal = 0

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/xero/user-invoices`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.ok) {
      const data = await response.json()
      invoices = data.invoices || []
      
      // Calculate unpaid stats
      const unpaidInvoices = invoices.filter(invoice => 
        invoice.status !== 'PAID' && invoice.status !== 'VOIDED'
      )
      unpaidCount = unpaidInvoices.length
      unpaidTotal = unpaidInvoices.reduce((sum: number, invoice: any) => sum + (invoice.amountDue || 0), 0)
    }
  } catch (error) {
    console.error('Error fetching invoices from Xero:', error)
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link 
          href="/user"
          className="text-blue-600 hover:text-blue-500 text-sm font-medium mb-4 inline-block"
        >
          ← Back to Dashboard
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Invoices</h1>
            <p className="text-gray-600 mt-1">
              View and manage your invoices from {getOrganizationName()}
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{invoices.length}</div>
              <div className="text-sm text-gray-600">Total Invoices</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{unpaidCount}</div>
              <div className="text-sm text-gray-600">Unpaid Invoices</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{formatAmount(unpaidTotal)}</div>
              <div className="text-sm text-gray-600">Total Outstanding</div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoices List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Invoice History</h2>
        </div>

        {invoices.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Invoices Found</h3>
            <p className="text-gray-600">
              You don't have any invoices yet. Invoices will appear here once they're created.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {invoices.map((invoice) => {
              const isPaid = invoice.status === 'PAID'
              const isOverdue = !isPaid && invoice.dueDate && isInvoiceOverdue(invoice.dueDate)
              const daysUntilDue = invoice.dueDate ? getDaysUntilDue(invoice.dueDate) : null

              return (
                <li key={invoice.invoiceID} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className={`w-2 h-2 rounded-full ${
                              isPaid ? 'bg-green-400' : 
                              isOverdue ? 'bg-red-400' : 
                              'bg-yellow-400'
                            }`}></div>
                          </div>
                          <div className="ml-4">
                            <div className="flex items-center">
                              <span className="text-sm font-medium text-gray-900">
                                Invoice #{invoice.invoiceNumber}
                              </span>
                              <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                isPaid ? 'bg-green-100 text-green-800' :
                                isOverdue ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>
                                {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Unpaid'}
                              </span>
                            </div>
                            <div className="text-sm text-gray-500">
                              {new Date(invoice.date).toLocaleDateString()}
                              {invoice.dueDate && (
                                <span className="ml-2">
                                  • Due: {new Date(invoice.dueDate).toLocaleDateString()}
                                  {daysUntilDue !== null && !isPaid && (
                                    <span className={`ml-1 ${
                                      isOverdue ? 'text-red-600' : 'text-gray-600'
                                    }`}>
                                      ({daysUntilDue > 0 ? `${daysUntilDue} days` : `${Math.abs(daysUntilDue)} days overdue`})
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-gray-900">
                            {formatAmount(invoice.amountDue || invoice.total)}
                          </div>
                          {invoice.amountDue && invoice.amountDue !== invoice.total && (
                            <div className="text-xs text-gray-500">
                              Total: {formatAmount(invoice.total)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 ml-4">
                      {!isPaid && (
                        <a
                          href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${invoice.invoiceID}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          Pay Now
                          <svg className="ml-2 -mr-0.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      <a
                        href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${invoice.invoiceID}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-500"
                      >
                        View Invoice
                      </a>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Help Text */}
      <div className="mt-6 text-center">
        <p className="text-sm text-gray-500">
          Need help with your invoices? Contact us at{' '}
          <a href="mailto:support@example.com" className="text-blue-600 hover:text-blue-500">
            support@example.com
          </a>
        </p>
      </div>
    </div>
  )
} 