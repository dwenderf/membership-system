import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/date-utils'
import { formatAmount, isInvoiceOverdue, getDaysUntilDue } from '@/lib/format-utils'
import { getOrganizationName } from '@/lib/organization'
import Link from 'next/link'
import { getOrCreateXeroContact } from '@/lib/xero/contacts'
import { getActiveTenant, getAuthenticatedXeroClient } from '@/lib/xero/client'
import { Logger } from '@/lib/logging/logger'

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

  // Fetch invoices from Xero API with improved filtering
  let invoices: any[] = []
  let unpaidCount = 0
  let unpaidTotal = 0
  const logger = Logger.getInstance()

  try {
    logger.logSystem('invoice-fetch-start', 'Starting invoice fetch for user', { userId: user.id })
    
    // Step 1: Get the active Xero tenant
    const activeTenant = await getActiveTenant()
    if (activeTenant) {
      logger.logSystem('tenant-found', 'Active Xero tenant found', { 
        tenantName: activeTenant.tenant_name,
        tenantId: activeTenant.tenant_id 
      })
      
      // Step 2: Get or create the user's Xero contact ID
      const contactResult = await getOrCreateXeroContact(user.id, activeTenant.tenant_id)
      
      if (contactResult.success && contactResult.xeroContactId) {
        logger.logSystem('contact-found', 'User Xero contact found', { 
          userId: user.id,
          xeroContactId: contactResult.xeroContactId 
        })
        
        // Step 3: Fetch invoices from Xero API using the contact ID filter
        const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
        if (xeroApi) {
          logger.logSystem('xero-client-ready', 'Xero client authenticated and ready')
          
          // First, let's try to get the contact to verify it exists
          try {
            const contactResponse = await xeroApi.accountingApi.getContact(
              activeTenant.tenant_id,
              contactResult.xeroContactId
            )
            const contactName = contactResponse.body.contacts?.[0]?.name
            logger.logSystem('contact-verified', 'Contact verified in Xero', { contactName })
          } catch (contactError) {
            logger.logSystem('contact-not-found', 'Contact not found in Xero, proceeding with invoice filtering', { 
              error: contactError instanceof Error ? contactError.message : 'Unknown error' 
            })
          }
          
          // Try filtering invoices by contact ID
          let allInvoices: any[] = []
          
          try {
            const filterString = `Contact.ContactID=guid("${contactResult.xeroContactId}")`
            logger.logSystem('api-call-filtered', 'Fetching invoices with contact filter', { 
              filter: filterString 
            })
            
            // Add includePayments: true to the API call
            const invoicesResponse = await xeroApi.accountingApi.getInvoices(
              activeTenant.tenant_id,
              undefined, // ifModifiedSince
              filterString,
              undefined, // order
              undefined, // ids
              undefined, // invoiceNumbers
              undefined, // contactIDs
              undefined, // statuses
              undefined, // page
              true // includePayments
            )
            
            allInvoices = invoicesResponse.body.invoices || []
          } catch (filterError) {
            logger.logSystem('api-call-error', 'Failed to fetch invoices from Xero', { 
              error: filterError instanceof Error ? filterError.message : 'Unknown error',
              userId: user.id 
            }, 'error')
            throw filterError
          }
          
          // Filter invoices for this specific contact
          const userInvoices = allInvoices.filter((invoice: any) => {
            const isCorrectContact = invoice.contact?.contactID === contactResult.xeroContactId
            const isCorrectType = invoice.type === 'ACCREC'
            const isCorrectStatus = (invoice.status === 'AUTHORISED' || invoice.status === 'PAID')
            
            return isCorrectContact && isCorrectType && isCorrectStatus
          })
          
          // Log summary instead of every invoice
          if (allInvoices.length > 10) {
            const contactSummary = allInvoices.reduce((acc: any, invoice: any) => {
              const contactId = invoice.contact?.contactID
              const contactName = invoice.contact?.name
              if (!acc[contactId]) {
                acc[contactId] = { name: contactName, count: 0, types: new Set() }
              }
              acc[contactId].count++
              acc[contactId].types.add(invoice.type)
              return acc
            }, {})
            
            logger.logSystem('invoice-summary', 'Invoice summary by contact', { 
              totalInvoices: allInvoices.length,
              userInvoices: userInvoices.length,
              contactSummary,
              userContactId: contactResult.xeroContactId
            })
          }
          
          logger.logSystem('filtering-complete', 'Invoice filtering completed', { 
            totalInvoices: allInvoices.length,
            filteredInvoices: userInvoices.length 
          })
          
          // Format the invoices for the frontend
          const formattedInvoices = await Promise.all(userInvoices.map(async (invoice: any) => {
            // Sum up all payments and get the most recent payment date
            let totalPaid = 0
            let latestPaymentDate = null
            if (invoice.payments && invoice.payments.length > 0) {
              totalPaid = invoice.payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
              latestPaymentDate = invoice.payments.reduce((latest: string | null, p: any) => {
                if (!latest || new Date(p.date) > new Date(latest)) {
                  return p.date
                }
                return latest
              }, null)
            }



            return {
              id: invoice.invoiceID,
              number: invoice.invoiceNumber,
              status: invoice.status,
              type: invoice.type,
              total: Math.round(invoice.total * 100), // Convert dollars to cents
              amountDue: Math.round((invoice.amountDue || 0) * 100), // Convert dollars to cents
              amountPaid: Math.round((invoice.amountPaid || 0) * 100), // Convert dollars to cents
              date: invoice.date,
              dueDate: invoice.dueDate,
              reference: invoice.reference,
              url: undefined, // No URL needed for list view
              lineItems: invoice.lineItems?.map((item: any) => ({
                description: item.description,
                quantity: item.quantity,
                unitAmount: Math.round((item.unitAmount || 0) * 100), // Convert dollars to cents
                lineAmount: Math.round((item.lineAmount || 0) * 100), // Convert dollars to cents
                accountCode: item.accountCode
              })) || [],
              payments: invoice.payments?.map((payment: any) => ({
                paymentID: payment.paymentID || '',
                date: payment.date || '',
                amount: Math.round((payment.amount || 0) * 100), // Convert dollars to cents
                reference: payment.reference || ''
              })) || [],
              totalPaid: Math.round(totalPaid * 100), // Convert dollars to cents
              latestPaymentDate
            }
          }))
          
          // Sort invoices by date (newest first)
          invoices = formattedInvoices.sort((a, b) => {
            const dateA = new Date(a.date).getTime()
            const dateB = new Date(b.date).getTime()
            return dateB - dateA // Descending order (newest first)
          })
          
          // Calculate unpaid stats
          const unpaidInvoices = invoices.filter(invoice => 
            invoice.status !== 'PAID' && invoice.status !== 'VOIDED'
          )
          unpaidCount = unpaidInvoices.length
          unpaidTotal = unpaidInvoices.reduce((sum: number, invoice: any) => sum + (invoice.amountDue || 0), 0)
          
          // Sort invoices: unpaid first, then by date descending
          invoices = formattedInvoices.sort((a, b) => {
            const isAUnpaid = a.status !== 'PAID' && a.status !== 'VOIDED'
            const isBUnpaid = b.status !== 'PAID' && b.status !== 'VOIDED'
            
            // If one is unpaid and the other isn't, unpaid comes first
            if (isAUnpaid && !isBUnpaid) return -1
            if (!isAUnpaid && isBUnpaid) return 1
            
            // If both have the same payment status, sort by date descending
            const dateA = new Date(a.date).getTime()
            const dateB = new Date(b.date).getTime()
            return dateB - dateA
          })
          
          logger.logSystem('invoice-fetch-complete', 'Invoice fetch completed successfully', { 
            totalInvoices: invoices.length,
            unpaidCount,
            unpaidTotal: unpaidTotal / 100, // Convert back to dollars for logging
            userId: user.id
          })
        }
      }
    }
  } catch (error) {
    logger.logSystem('invoice-fetch-error', 'Error fetching invoices from Xero', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: user.id 
    }, 'error')
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
                <li key={invoice.id} className="px-6 py-4">
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
                                Invoice #{invoice.number}
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
                              {formatDate(new Date(invoice.date))}
                              {invoice.total > 0 && isPaid && invoice.latestPaymentDate ? (
                                <span className="ml-2">
                                  • Paid: {formatDate(new Date(invoice.latestPaymentDate))}
                                </span>
                              ) : invoice.total > 0 && invoice.dueDate && (
                                <span className="ml-2">
                                  • Due: {formatDate(new Date(invoice.dueDate))}
                                  {daysUntilDue !== null && (
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
                            {isPaid ? formatAmount(invoice.total) : formatAmount(invoice.amountDue)}
                          </div>
                          {!isPaid && invoice.amountDue !== invoice.total && (
                            <div className="text-xs text-gray-500">
                              Total: {formatAmount(invoice.total)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 ml-4">
                      <Link
                        href={`/user/invoices/${invoice.id}`}
                        className="text-sm text-blue-600 hover:text-blue-500"
                      >
                        View Invoice
                      </Link>
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