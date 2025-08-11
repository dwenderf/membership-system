/**
 * Format amount from cents to dollars
 */
export function formatAmount(amountInCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amountInCents / 100)
}

/**
 * Get the due date for an invoice (30 days from creation by default)
 */
export function getInvoiceDueDate(createdAt: string): Date {
  const createdDate = new Date(createdAt)
  const dueDate = new Date(createdDate)
  dueDate.setDate(dueDate.getDate() + 30) // 30 days from creation
  return dueDate
}

/**
 * Check if an invoice is overdue
 */
export function isInvoiceOverdue(createdAt: string): boolean {
  const dueDate = getInvoiceDueDate(createdAt)
  return new Date() > dueDate
}

/**
 * Get the number of days until an invoice is due (negative if overdue)
 */
export function getDaysUntilDue(createdAt: string): number {
  const dueDate = getInvoiceDueDate(createdAt)
  const now = new Date()
  const diffTime = dueDate.getTime() - now.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Get a user-friendly message about unpaid invoices for registration flows
 */
export function getUnpaidInvoicesMessage(unpaidCount: number, totalAmount: number): string {
  if (unpaidCount === 0) {
    return ''
  }

  return `You have ${unpaidCount} unpaid invoice${unpaidCount !== 1 ? 's' : ''} totaling ${formatAmount(totalAmount)}. Would you like to pay these now before proceeding with your registration?`
}

/**
 * Generate the public customer-facing Xero invoice URL
 * Note: Xero doesn't provide an API to generate public links, so we use the admin URL
 * which requires Xero login. For true public links, they must be manually generated
 * through the Xero web interface and shared with customers.
 */
export function getXeroInvoicePublicUrl(xeroInvoiceId: string): string {
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xeroInvoiceId}`
}

/**
 * Generate the admin Xero invoice URL (for internal use only)
 * This is the URL that admins use to view invoices in the Xero admin interface
 */
export function getXeroInvoiceAdminUrl(xeroInvoiceId: string): string {
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xeroInvoiceId}`
}