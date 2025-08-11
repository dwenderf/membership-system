import { createClient } from '@/lib/supabase/server'
import { formatAmount, getDaysUntilDue, getInvoiceDueDate, isInvoiceOverdue } from '@/lib/format-utils'

export interface UnpaidInvoiceInfo {
  count: number
  totalAmount: number // in cents
  invoices: Array<{
    id: string
    invoice_number: string | null
    xero_invoice_id: string | null
    total_amount: number
    net_amount: number
    invoice_status: string
    created_at: string
    last_synced_at: string | null
    payment: {
      id: string
      status: string
      created_at: string
      completed_at: string | null
    } | null
  }>
}

/**
 * Check if a user has unpaid invoices
 * An invoice is considered unpaid if:
 * 1. It has been synced to Xero (has xero_invoice_id)
 * 2. The invoice status is not 'PAID'
 * 3. The associated payment is not completed
 */
export async function getUserUnpaidInvoices(userId: string): Promise<UnpaidInvoiceInfo> {
  const supabase = await createClient()
  
  // First get all payments for the user
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('id, status, created_at, completed_at')
    .eq('user_id', userId)

  if (paymentsError) {
    console.error('Error fetching payments:', paymentsError)
    return { count: 0, totalAmount: 0, invoices: [] }
  }

  const paymentIds = payments?.map(p => p.id) || []
  
  if (paymentIds.length === 0) {
    return { count: 0, totalAmount: 0, invoices: [] }
  }

  // Then get invoices for those payments
  const { data: invoices, error: invoicesError } = await supabase
    .from('xero_invoices')
    .select(`
      id,
      invoice_number,
      xero_invoice_id,
      total_amount,
      net_amount,
      invoice_status,
      created_at,
      last_synced_at,
      payment_id
    `)
    .in('payment_id', paymentIds)
    .not('xero_invoice_id', 'is', null) // Only invoices that have been synced to Xero
    .neq('invoice_status', 'PAID') // Not paid in Xero
    .order('created_at', { ascending: false })

  if (invoicesError) {
    console.error('Error fetching invoices:', invoicesError)
    return { count: 0, totalAmount: 0, invoices: [] }
  }

  // Combine the data
  const invoicesWithPayments = invoices?.map(invoice => {
    const payment = payments?.find(p => p.id === invoice.payment_id)
    return {
      ...invoice,
      payment: payment || null
    }
  }) || []

  const unpaidInvoices = invoicesWithPayments.filter(invoice => {
    // Filter out invoices where the payment is completed (paid via Stripe)
    return !invoice.payment?.completed_at
  })

  const totalAmount = unpaidInvoices.reduce((sum, invoice) => sum + invoice.net_amount, 0)

  return {
    count: unpaidInvoices.length,
    totalAmount,
    invoices: unpaidInvoices
  }
}

/**
 * Check if a user has any unpaid invoices (simple boolean check)
 */
export async function hasUnpaidInvoices(userId: string): Promise<boolean> {
  const unpaidInfo = await getUserUnpaidInvoices(userId)
  return unpaidInfo.count > 0
}

/**
 * Check if a user should be prevented from registering due to unpaid invoices
 * This can be used in registration flows to enforce payment compliance
 */
export async function shouldPreventRegistration(userId: string): Promise<{
  prevent: boolean
  reason?: string
  unpaidCount: number
  totalAmount: number
}> {
  const unpaidInfo = await getUserUnpaidInvoices(userId)
  
  if (unpaidInfo.count === 0) {
    return {
      prevent: false,
      unpaidCount: 0,
      totalAmount: 0
    }
  }

  // Check if any invoices are significantly overdue (more than 60 days)
  const significantlyOverdue = unpaidInfo.invoices.some(invoice => {
    const daysOverdue = getDaysUntilDue(invoice.created_at)
    return daysOverdue < -60
  })

  if (significantlyOverdue) {
    return {
      prevent: true,
      reason: `You have ${unpaidInfo.count} unpaid invoice${unpaidInfo.count !== 1 ? 's' : ''} that are significantly overdue. Please pay your outstanding balance of ${formatAmount(unpaidInfo.totalAmount)} before registering for new activities.`,
      unpaidCount: unpaidInfo.count,
      totalAmount: unpaidInfo.totalAmount
    }
  }

  // For less severe cases, just warn but don't prevent
  return {
    prevent: false,
    unpaidCount: unpaidInfo.count,
    totalAmount: unpaidInfo.totalAmount
  }
} 