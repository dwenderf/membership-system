import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatAmount } from '@/lib/format-utils'
import { Logger } from '@/lib/logging/logger'
import RefundModal from './RefundModal'
import { formatDate } from '@/lib/date-utils'

interface PageProps {
  params: {
    id: string
    invoiceId: string // This is actually a paymentId
  }
}

export default async function AdminUserInvoiceDetailPage({ params }: PageProps) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  // Check if user is admin
  const { data: { user: authUser } } = await supabase.auth.getUser()
  
  if (!authUser) {
    redirect('/admin/reports/users')
  }

  const { data: currentUser } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', authUser.id)
    .single()

  if (!currentUser?.is_admin) {
    redirect('/admin/reports/users')
  }

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

  // Fetch payment details (invoiceId is actually paymentId)
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select(`
      *,
      xero_invoices!left (
        id,
        xero_invoice_id,
        invoice_number,
        invoice_status,
        total_amount,
        net_amount,
        xero_invoice_line_items (
          id,
          description,
          line_amount,
          account_code,
          line_item_type
        )
      )
    `)
    .eq('id', params.invoiceId)
    .eq('user_id', params.id)
    .single()

  if (paymentError || !payment) {
    logger.logSystem('admin-invoice-payment-error', 'Error fetching payment for invoice detail', { 
      paymentId: params.invoiceId,
      userId: params.id,
      error: paymentError?.message 
    })
    redirect(`/admin/reports/users/${params.id}`)
  }

  // Fetch refund history for this payment
  const { data: refunds } = await supabase
    .from('refunds')
    .select(`
      *,
      processed_by_user:processed_by(first_name, last_name, email)
    `)
    .eq('payment_id', payment.id)
    .order('created_at', { ascending: false })

  // Fetch credit notes for each refund to get line item details
  const refundsWithCreditNotes = await Promise.all(
    (refunds || []).map(async (refund) => {
      const { data: creditNote } = await supabase
        .from('xero_invoices')
        .select(`
          id,
          invoice_number,
          xero_invoice_line_items(
            id,
            description,
            line_amount,
            account_code
          )
        `)
        .eq('payment_id', payment.id)
        .eq('invoice_type', 'ACCRECCREDIT')
        .eq('staging_metadata->>refund_id', refund.id)
        .maybeSingle()

      return {
        ...refund,
        credit_note: creditNote
      }
    })
  )

  // Calculate refund summary
  const totalRefunded = refundsWithCreditNotes?.reduce((sum, refund) => {
    return refund.status === 'completed' ? sum + refund.amount : sum
  }, 0) || 0

  const availableForRefund = payment.final_amount - totalRefunded
  const canRefund = payment.status === 'completed' && totalRefunded === 0

  const invoice = {
    id: payment.id,
    number: payment.xero_invoices?.[0]?.invoice_number || `PAY-${payment.id.slice(0, 8)}`,
    date: payment.completed_at || payment.created_at,
    amount: payment.final_amount,
    status: payment.status,
    hasXeroInvoice: !!payment.xero_invoices?.[0],
    lineItems: payment.xero_invoices?.[0]?.xero_invoice_line_items || []
  }

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
                <h1 className="text-2xl font-bold text-gray-900">Payment Details</h1>
                <p className="text-gray-600 mt-1">
                  Payment for {user.first_name} {user.last_name} ({user.email})
                </p>
              </div>
              {/* Refund button */}
              <div className="flex space-x-3">
                {canRefund ? (
                  <RefundModal
                    paymentId={payment.id}
                    availableAmount={availableForRefund}
                    paymentAmount={payment.final_amount}
                    invoiceNumber={invoice.number}
                  />
                ) : (
                  <button
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-400 bg-gray-100 cursor-not-allowed"
                    disabled
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m5 5v1a4 4 0 01-4 4H8m0 0l3-3m-3 3l3 3"></path>
                    </svg>
                    {totalRefunded >= payment.final_amount ? 'Fully Refunded' : 
                     totalRefunded > 0 ? 'Partially Refunded' : 'Cannot Refund'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Payment details */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Invoice Number</dt>
                  <dd className="mt-1 text-sm text-gray-900">{invoice.number}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Payment Date</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {formatDate(new Date(invoice.date))}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Payment Amount</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatAmount(payment.final_amount)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Status</dt>
                  <dd className="mt-1">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      payment.status === 'completed' ? 'bg-green-100 text-green-800' :
                      payment.status === 'refunded' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                    </span>
                  </dd>
                </div>
                {payment.stripe_payment_intent_id && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Stripe Payment ID</dt>
                    <dd className="mt-1 text-xs text-gray-900 font-mono">
                      {payment.stripe_payment_intent_id}
                    </dd>
                  </div>
                )}
                {totalRefunded > 0 && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Total Refunded</dt>
                    <dd className="mt-1 text-sm text-red-600 font-medium">
                      -{formatAmount(totalRefunded)}
                    </dd>
                  </div>
                )}
              </div>
              
              {/* Line items if available */}
              {invoice.lineItems.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Line Items</h4>
                  <div className="border rounded-md">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account Code</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {invoice.lineItems.map((item: any) => (
                          <tr key={item.id}>
                            <td className="px-4 py-2 text-sm text-gray-900">{item.description}</td>
                            <td className="px-4 py-2 text-sm text-gray-500">{item.account_code}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 text-right">
                              {formatAmount(item.line_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Refund History Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Refund History</h3>
              {refundsWithCreditNotes && refundsWithCreditNotes.length > 0 ? (
                <div className="space-y-6">
                  {refundsWithCreditNotes.map((refund) => (
                    <div key={refund.id} className="pb-6 border-b border-gray-100 last:border-b-0 last:pb-0">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Refund Status</dt>
                          <dd className="mt-1">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              refund.status === 'completed' ? 'bg-green-100 text-green-800' :
                              refund.status === 'failed' ? 'bg-red-100 text-red-800' :
                              refund.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {refund.status.charAt(0).toUpperCase() + refund.status.slice(1)}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Refund Amount</dt>
                          <dd className="mt-1 text-sm text-gray-900">-{formatAmount(refund.amount)}</dd>
                        </div>
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Refund Date</dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            {formatDate(new Date(refund.created_at))}
                          </dd>
                        </div>
                        {refund.credit_note?.invoice_number && (
                          <div>
                            <dt className="text-sm font-medium text-gray-500">Credit Note Number</dt>
                            <dd className="mt-1 text-sm text-gray-900">{refund.credit_note.invoice_number}</dd>
                          </div>
                        )}
                        {refund.stripe_refund_id && (
                          <div>
                            <dt className="text-sm font-medium text-gray-500">Stripe Refund ID</dt>
                            <dd className="mt-1 text-xs text-gray-900 font-mono">
                              {refund.stripe_refund_id}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Processed By</dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            {refund.processed_by_user?.first_name} {refund.processed_by_user?.last_name}
                          </dd>
                        </div>
                      </div>
                      
                      {refund.reason && (
                        <div className="mb-4">
                          <dt className="text-sm font-medium text-gray-500">Reason</dt>
                          <dd className="mt-1 text-sm text-gray-900">{refund.reason}</dd>
                        </div>
                      )}
                      
                      {refund.failure_reason && (
                        <div className="mb-4">
                          <dt className="text-sm font-medium text-gray-500">Failure Reason</dt>
                          <dd className="mt-1 text-sm text-red-600">{refund.failure_reason}</dd>
                        </div>
                      )}

                      {/* Credit Note Line Items */}
                      {refund.credit_note?.xero_invoice_line_items && refund.credit_note.xero_invoice_line_items.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-gray-900 mb-3">Credit Note Line Items</h4>
                          <div className="border rounded-md">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account Code</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {refund.credit_note.xero_invoice_line_items.map((item: any) => (
                                  <tr key={item.id}>
                                    <td className="px-4 py-2 text-sm text-gray-900">{item.description}</td>
                                    <td className="px-4 py-2 text-sm text-gray-500">{item.account_code}</td>
                                    <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                      {formatAmount(item.line_amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No refunds have been processed for this payment.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
