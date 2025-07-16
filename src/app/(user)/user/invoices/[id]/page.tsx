import { createClient } from '@/lib/supabase/server'
import { formatAmount, getInvoiceDueDate } from '@/lib/invoice-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface PageProps {
  params: {
    id: string
  }
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  // Get the invoice with line items and payment information
  const { data: invoice } = await supabase
    .from('xero_invoices')
    .select(`
      id,
      invoice_number,
      xero_invoice_id,
      total_amount,
      discount_amount,
      net_amount,
      invoice_status,
      created_at,
      payment_id,
      payments!inner(
        id,
        status,
        created_at,
        completed_at,
        final_amount,
        user_id
      )
    `)
    .eq('id', params.id)
    .eq('payments.user_id', user.id) // Ensure user owns this invoice
    .single()

  if (!invoice) {
    redirect('/user/invoices')
  }

  // Get line items for this invoice
  const { data: lineItems } = await supabase
    .from('xero_invoice_line_items')
    .select(`
      id,
      line_item_type,
      description,
      quantity,
      unit_amount,
      line_amount,
      account_code
    `)
    .eq('xero_invoice_id', params.id)
    .order('created_at', { ascending: true })

  // Get payments for this invoice (there should only be one, but let's be safe)
  const { data: payments } = await supabase
    .from('payments')
    .select(`
      id,
      status,
      created_at,
      completed_at,
      final_amount
    `)
    .eq('id', invoice.payment_id)
    .order('created_at', { ascending: true })

  const dueDate = getInvoiceDueDate(invoice.created_at)
  const isPaid = invoice.invoice_status === 'PAID' || payments?.some(p => p.status === 'completed')

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
              Invoice #{invoice.invoice_number || 'Pending'}
            </h1>
            <p className="text-gray-600 mt-1">
              {new Date(invoice.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">
              {formatAmount(invoice.net_amount)}
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
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div>
            <h3 className="text-sm font-medium text-gray-500">Invoice Number</h3>
            <p className="text-lg font-medium text-gray-900">
              {invoice.invoice_number || 'Pending'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500">Due Date</h3>
            <p className="text-lg font-medium text-gray-900">
              {dueDate ? dueDate.toLocaleDateString() : 'Not set'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500">Status</h3>
            <p className={`text-lg font-medium ${
              isPaid ? 'text-green-600' : 'text-red-600'
            }`}>
              {isPaid ? 'Paid' : 'Unpaid'}
            </p>
          </div>
        </div>

        {/* Line Items */}
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Line Items</h3>
          <div className="space-y-4">
            {lineItems?.map((item) => (
              <div key={item.id} className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0">
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{item.description}</div>
                  <div className="text-sm text-gray-500">
                    Quantity: {item.quantity} × {formatAmount(item.unit_amount)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-gray-900">
                    {formatAmount(item.line_amount)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-4 mt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal:</span>
                <span className="text-gray-900">{formatAmount(invoice.total_amount)}</span>
              </div>
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Discounts:</span>
                  <span className="text-red-600">-{formatAmount(invoice.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t border-gray-200 pt-2">
                <span>Total:</span>
                <span>{formatAmount(invoice.net_amount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payments */}
      {payments && payments.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Payments</h3>
          <div className="space-y-4">
            {payments.map((payment) => (
              <div key={payment.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                <div>
                  <div className="font-medium text-gray-900">
                    Payment #{payment.id.slice(0, 8)}
                  </div>
                  <div className="text-sm text-gray-500">
                    {payment.completed_at 
                      ? `Paid on ${new Date(payment.completed_at).toLocaleDateString()}`
                      : `Created on ${new Date(payment.created_at).toLocaleDateString()}`
                    }
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-gray-900">
                    {formatAmount(payment.final_amount)}
                  </div>
                  <div className={`text-sm font-medium ${
                    payment.status === 'completed' ? 'text-green-600' : 'text-yellow-600'
                  }`}>
                    {payment.status === 'completed' ? 'Completed' : payment.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isPaid && (
        <div className="mt-6 flex justify-center">
          <Link
            href={`/user/invoices`}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Pay Now
          </Link>
        </div>
      )}
    </div>
  )
} 