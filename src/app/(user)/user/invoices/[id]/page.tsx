import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/date-utils'
import { formatAmount } from '@/lib/format-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getAuthenticatedXeroClient, getActiveTenant } from '@/lib/xero/client'
import { getOrCreateXeroContact } from '@/lib/xero/contacts'
import { logger } from '@/lib/logging/logger'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

interface UserInvoice {
  id: string
  number: string
  status: string
  type: string
  total: number
  amountDue: number
  amountPaid: number
  date: string
  dueDate: string
  reference: string
  url?: string // Public payment URL from Xero
  lineItems: Array<{
    description: string
    quantity: number
    unitAmount: number
    lineAmount: number
    accountCode: string
  }>
  payments: Array<{
    paymentID: string
    date: string
    amount: number
    reference: string
  }>
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Await params for Next.js 15 compatibility
  const { id } = await params

  try {
    // Get Xero client and tenant
    const tenant = await getActiveTenant()
    
    if (!tenant) {
      logger.logXeroSync('no-xero-tenant', 'No active Xero tenant found')
      redirect('/user/invoices')
    }

    const xeroClient = await getAuthenticatedXeroClient(tenant.tenant_id)
    if (!xeroClient) {
      logger.logXeroSync('xero-client-failed', 'Failed to get authenticated Xero client')
      redirect('/user/invoices')
    }

    // Get or create user's Xero contact
    const contact = await getOrCreateXeroContact(user.id, tenant.tenant_id)
    if (!contact.success || !contact.xeroContactId) {
      logger.logXeroSync('contact-not-found', 'Failed to get or create Xero contact', { userId: user.id })
      redirect('/user/invoices')
    }

    // Fetch the specific invoice by ID from Xero API
    logger.logXeroSync('invoice-fetch-start', 'Fetching single invoice from Xero', { invoiceId: id })
    
    const response = await xeroClient.accountingApi.getInvoice(
      tenant.tenant_id,
      id
    )
    
    if (!response.body.invoices || response.body.invoices.length === 0) {
      logger.logXeroSync('invoice-not-found', 'Invoice not found in Xero', { invoiceId: id })
      redirect('/user/invoices')
    }

    const xeroInvoice = response.body.invoices[0]
    
    // Fetch the online invoice URL from the separate endpoint
    let publicUrl = undefined;
    try {
      const onlineInvoiceResponse = await xeroClient.accountingApi.getOnlineInvoice(tenant.tenant_id, id);
      logger.logXeroSync('online-invoice-response', 'Online invoice response', { 
        invoiceId: id,
        response: onlineInvoiceResponse.body
      });
      publicUrl = onlineInvoiceResponse.body.onlineInvoices?.[0]?.onlineInvoiceUrl || undefined;
    } catch (error) {
      logger.logXeroSync('online-invoice-error', 'Failed to get online invoice URL', { 
        invoiceId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't fail the request if we can't get the online URL
    }
    
    // Debug: Log the invoice fields to see what's available
    logger.logXeroSync('invoice-debug', 'Raw invoice fields', { 
      invoiceId: id,
      fields: Object.keys(xeroInvoice),
      publicUrl
    })
    
    // Verify the invoice belongs to the current user
    if (xeroInvoice.contact?.contactID !== contact.xeroContactId) {
      logger.logXeroSync('invoice-access-denied', 'Invoice does not belong to user', { 
        invoiceId: id, 
        invoiceContactId: xeroInvoice.contact?.contactID,
        userContactId: contact.xeroContactId 
      })
      redirect('/user/invoices')
    }

    // Convert Xero invoice to our format
    const invoice: UserInvoice = {
      id: xeroInvoice.invoiceID!,
      number: xeroInvoice.invoiceNumber || 'Pending',
      status: String(xeroInvoice.status || 'DRAFT'),
      type: String(xeroInvoice.type || 'ACCREC'),
      total: (xeroInvoice.total || 0) * 100, // Convert dollars to cents
      amountDue: (xeroInvoice.amountDue || 0) * 100,
      amountPaid: (xeroInvoice.amountPaid || 0) * 100,
      date: xeroInvoice.date || '',
      dueDate: xeroInvoice.dueDate || '',
      reference: xeroInvoice.reference || '',
      url: publicUrl, // Public payment URL from Xero
      lineItems: xeroInvoice.lineItems?.map((item: any) => ({
        description: item.description || '',
        quantity: item.quantity || 0,
        unitAmount: (item.unitAmount || 0) * 100,
        lineAmount: (item.lineAmount || 0) * 100,
        accountCode: typeof item.accountCode === 'string' ? item.accountCode : item.accountCode?.code || ''
      })) || [],
      payments: xeroInvoice.payments?.map((payment: any) => ({
        paymentID: payment.paymentID || '',
        date: payment.date || '',
        amount: (payment.amount || 0) * 100, // Convert dollars to cents
        reference: payment.reference || ''
      })) || []
    }

    logger.logXeroSync('invoice-fetch-success', 'Invoice fetched successfully', { 
      invoiceId: id,
      invoiceNumber: invoice.number,
      userId: user.id 
    })

    const isPaid = invoice.status === 'PAID' || invoice.amountDue === 0

    return (
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <Link 
            href="/user/invoices"
            className="text-blue-600 hover:text-blue-500 text-sm font-medium mb-4 inline-block"
          >
            ← Back to Invoices
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Invoice #{invoice.number || 'Pending'}
              </h1>
              <p className="text-gray-600 mt-1">
                {formatDate(new Date(invoice.date))}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">
                {formatAmount(invoice.total)}
              </div>
              <div className={`text-sm font-medium ${
                isPaid ? 'text-green-600' : 'text-red-600'
              }`}>
                {isPaid ? 'Paid' : 'Unpaid'}
              </div>
            </div>
          </div>
        </div>

        {/* Invoice Details */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 relative">
          {/* Pay button in top-right corner */}
          {!isPaid && invoice.url && (
            <div className="absolute top-4 right-4">
              <a
                href={invoice.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Pay Now
              </a>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Invoice Number</h3>
              <p className="text-lg font-medium text-gray-900">
                {invoice.number || 'Pending'}
              </p>
            </div>
            {invoice.total > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Due Date</h3>
                <p className="text-lg font-medium text-gray-900">
                  {invoice.dueDate ? formatDate(new Date(invoice.dueDate)) : 'Not set'}
                </p>
              </div>
            )}
            <div>
              <h3 className="text-sm font-medium text-gray-500">Status</h3>
              <p className={`text-lg font-medium ${
                invoice.total === 0 ? 'text-gray-600' : isPaid ? 'text-green-600' : 'text-red-600'
              }`}>
                {invoice.total === 0 ? 'No Payment Required' : isPaid ? 'Paid' : 'Unpaid'}
              </p>
            </div>
          </div>

          {/* Line Items */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Line Items</h3>
            <div className="space-y-4">
              {invoice.lineItems?.map((item, index) => (
                <div key={index} className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{item.description}</div>
                    <div className="text-sm text-gray-500">
                      Quantity: {item.quantity} × {formatAmount(item.unitAmount)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-gray-900">
                      {formatAmount(item.lineAmount)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t border-gray-200 pt-4 mt-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Total:</span>
                  <span className="text-gray-900">{formatAmount(invoice.total)}</span>
                </div>
                {invoice.total > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Amount Paid:</span>
                      <span className="text-green-600">{formatAmount(invoice.amountPaid)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold border-t border-gray-200 pt-2">
                      <span>Amount Due:</span>
                      <span className={invoice.amountDue > 0 ? 'text-red-600' : 'text-green-600'}>
                        {formatAmount(invoice.amountDue)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Status */}
        {invoice.total > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Status</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3">
                <div>
                  <div className="font-medium text-gray-900">
                    Invoice Status
                  </div>
                  <div className="text-sm text-gray-500">
                    {isPaid ? 'Fully Paid' : 'Payment Pending'}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${
                    isPaid ? 'text-green-600' : 'text-yellow-600'
                  }`}>
                    {isPaid ? 'Paid' : 'Unpaid'}
                  </div>
                </div>
              </div>
              

            </div>
          </div>
        )}

        {/* Payment History */}
        {invoice.payments && invoice.payments.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Payment History</h3>
            <div className="space-y-3">
              {invoice.payments.map((payment, index) => (
                <div key={index} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                  <div>
                    <div className="font-medium text-gray-900">
                      Payment #{payment.paymentID.slice(-8)}
                    </div>
                    <div className="text-sm text-gray-500">
                      {payment.date ? formatDate(new Date(payment.date)) : 'Date not available'}
                    </div>
                    {payment.reference && (
                      <div className="text-xs text-gray-400">
                        {payment.reference}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-green-600">
                      {formatAmount(payment.amount)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


      </div>
    )
  } catch (error) {
    logger.logXeroSync('invoice-detail-error', 'Error fetching invoice detail', { 
      error: error instanceof Error ? error.message : String(error),
      invoiceId: id,
      userId: user.id 
    })
    redirect('/user/invoices')
  }
}