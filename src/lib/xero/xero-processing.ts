/**
 * Xero Processing Utilities
 * 
 * Handles building JSON structures for Xero API batch operations
 */

import { Invoice, LineItem, Payment, CurrencyCode } from 'xero-node'
import { Database } from '../../types/database'

type XeroInvoiceRecord = Database['public']['Tables']['xero_invoices']['Row'] & {
  line_items: Database['public']['Tables']['xero_invoice_line_items']['Row'][]
}

type XeroPaymentRecord = Database['public']['Tables']['xero_payments']['Row']

/**
 * Build an invoice object for Xero API from database record
 */
export function buildInvoiceForXero(
  invoiceRecord: XeroInvoiceRecord, 
  xeroContactId: string
): Invoice {
  // Parse staging metadata
  const metadata = invoiceRecord.staging_metadata as any

  // Build line items from database records
  const lineItems: LineItem[] = invoiceRecord.line_items.map(item => ({
    description: item.description || '',
    quantity: item.quantity || 1,
    unitAmount: item.unit_amount || 0,
    accountCode: item.account_code || undefined,
    taxType: item.tax_type || undefined,
    lineAmount: item.line_amount || undefined,
    itemCode: item.item_code || undefined
  }))

  // Determine invoice status based on net amount
  const invoiceStatus = invoiceRecord.net_amount === 0 
    ? Invoice.StatusEnum.AUTHORISED  // Zero-value invoices are always AUTHORISED
    : Invoice.StatusEnum.DRAFT       // Non-zero invoices start as DRAFT

  // Build the invoice object
  const invoice: Invoice = {
    type: Invoice.TypeEnum.ACCREC, // Accounts Receivable
    contact: {
      contactID: xeroContactId
    },
    date: new Date(invoiceRecord.invoice_date),
    dueDate: new Date(invoiceRecord.due_date),
    lineItems: lineItems,
    reference: invoiceRecord.reference || undefined,
    invoiceNumber: invoiceRecord.invoice_number || undefined,
    currencyCode: (invoiceRecord.currency_code as CurrencyCode) || CurrencyCode.USD,
    status: invoiceStatus
  }

  return invoice
}

/**
 * Build a payment object for Xero API from database record
 */
export function buildPaymentForXero(
  paymentRecord: XeroPaymentRecord,
  xeroInvoiceId: string
): Payment {
  // Parse staging metadata
  const metadata = paymentRecord.staging_metadata as any

  const payment: Payment = {
    invoice: {
      invoiceID: xeroInvoiceId
    },
    account: {
      code: paymentRecord.account_code || '1200' // Default to checking account
    },
    amount: paymentRecord.amount,
    date: new Date(paymentRecord.payment_date),
    reference: paymentRecord.reference || undefined,
    currencyRate: paymentRecord.currency_rate || undefined
  }

  return payment
}

/**
 * Group records by tenant for batch processing
 */
export function groupRecordsByTenant<T extends { tenant_id: string }>(
  records: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  
  for (const record of records) {
    const tenantId = record.tenant_id
    if (!grouped.has(tenantId)) {
      grouped.set(tenantId, [])
    }
    grouped.get(tenantId)!.push(record)
  }
  
  return grouped
}

/**
 * Extract unique user IDs from invoice records for contact pre-sync
 */
export function extractUniqueUserIds(invoiceRecords: XeroInvoiceRecord[]): string[] {
  const userIds = new Set<string>()
  
  for (const invoice of invoiceRecords) {
    const metadata = invoice.staging_metadata as any
    if (metadata?.user_id) {
      userIds.add(metadata.user_id)
    }
  }
  
  return Array.from(userIds)
}

/**
 * Validate that all invoices have required fields for Xero API
 */
export function validateInvoicesForBatch(invoiceRecords: XeroInvoiceRecord[]): {
  valid: XeroInvoiceRecord[]
  invalid: { record: XeroInvoiceRecord; errors: string[] }[]
} {
  const valid: XeroInvoiceRecord[] = []
  const invalid: { record: XeroInvoiceRecord; errors: string[] }[] = []

  for (const invoice of invoiceRecords) {
    const errors: string[] = []
    
    // Check required fields
    if (!invoice.invoice_date) errors.push('Missing invoice_date')
    if (!invoice.due_date) errors.push('Missing due_date')
    if (!invoice.line_items || invoice.line_items.length === 0) {
      errors.push('Missing line_items')
    }
    
    // Check metadata for user_id
    const metadata = invoice.staging_metadata as any
    if (!metadata?.user_id) errors.push('Missing user_id in staging_metadata')
    
    if (errors.length === 0) {
      valid.push(invoice)
    } else {
      invalid.push({ record: invoice, errors })
    }
  }

  return { valid, invalid }
}

/**
 * Validate that all payments have required fields for Xero API
 */
export function validatePaymentsForBatch(paymentRecords: XeroPaymentRecord[]): {
  valid: XeroPaymentRecord[]
  invalid: { record: XeroPaymentRecord; errors: string[] }[]
} {
  const valid: XeroPaymentRecord[] = []
  const invalid: { record: XeroPaymentRecord; errors: string[] }[] = []

  for (const payment of paymentRecords) {
    const errors: string[] = []
    
    // Check required fields
    if (!payment.amount || payment.amount <= 0) errors.push('Invalid amount')
    if (!payment.payment_date) errors.push('Missing payment_date')
    if (!payment.xero_invoice_id) errors.push('Missing xero_invoice_id')
    
    if (errors.length === 0) {
      valid.push(payment)
    } else {
      invalid.push({ record: payment, errors })
    }
  }

  return { valid, invalid }
}