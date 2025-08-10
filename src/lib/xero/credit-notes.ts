import { CreditNote, LineItem, CurrencyCode, Contact } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync, getActiveTenant } from './client'
import { getOrCreateXeroContact } from './contacts'
import { createClient } from '../supabase/server'
import * as Sentry from '@sentry/nextjs'

export interface RefundCreditNoteData {
  refund_id: string
  payment_id: string
  user_id: string
  refund_amount: number // in cents
  reason?: string
  original_invoice_id?: string // Xero invoice ID to link credit note to
  line_items: Array<{
    description: string
    amount: number // in cents (negative for credit)
    account_code: string
    tax_type?: string
  }>
}

/**
 * Create a credit note in Xero for a refund
 */
export async function createXeroCreditNote(data: RefundCreditNoteData): Promise<{
  success: boolean
  creditNoteId?: string
  xeroCreditNote?: any
  error?: string
}> {
  try {
    logXeroSync('credit-note-creation-start', 'Starting credit note creation', {
      refundId: data.refund_id,
      paymentId: data.payment_id,
      amount: data.refund_amount
    })

    // Get authenticated Xero client
    const xeroResult = await getAuthenticatedXeroClient()
    if (!xeroResult.success || !xeroResult.client) {
      throw new Error('Failed to authenticate with Xero')
    }

    const { client: xero, tenantId } = xeroResult

    // Get or create Xero contact for the user
    const contactResult = await getOrCreateXeroContact(data.user_id)
    if (!contactResult.success || !contactResult.contactId) {
      throw new Error('Failed to get Xero contact for user')
    }

    // Prepare line items for credit note
    const lineItems: LineItem[] = data.line_items.map(item => ({
      description: item.description,
      quantity: 1,
      unitAmount: Math.abs(item.amount) / 100, // Convert to dollars, ensure positive
      accountCode: item.account_code,
      taxType: item.tax_type || 'NONE',
      lineAmount: Math.abs(item.amount) / 100
    }))

    // Create credit note object
    const creditNote: CreditNote = {
      type: 'ACCRECCREDIT', // Accounts Receivable Credit Note
      contact: {
        contactID: contactResult.contactId
      },
      lineItems: lineItems,
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
      status: 'AUTHORISED',
      currencyCode: 'USD' as CurrencyCode,
      reference: `Refund for Payment ${data.payment_id.slice(0, 8)}`,
      lineAmountTypes: 'Exclusive'
    }

    // Add reason to reference if provided
    if (data.reason) {
      creditNote.reference += ` - ${data.reason.substring(0, 100)}`
    }

    // If we have the original invoice ID, link the credit note to it
    if (data.original_invoice_id) {
      // Note: Xero doesn't have a direct "link to invoice" field for credit notes
      // We'll add it to the reference for tracking
      creditNote.reference += ` (Inv: ${data.original_invoice_id})`
    }

    // Create credit note in Xero
    logXeroSync('credit-note-api-call', 'Calling Xero API to create credit note', {
      tenantId,
      refundId: data.refund_id,
      contactId: contactResult.contactId
    })

    const response = await xero.accountingApi.createCreditNotes(tenantId, {
      creditNotes: [creditNote]
    })

    if (!response.body?.creditNotes?.[0]) {
      throw new Error('No credit note returned from Xero API')
    }

    const createdCreditNote = response.body.creditNotes[0]

    // Update refund record with Xero credit note ID
    const supabase = await createClient()
    const { error: updateError } = await supabase
      .from('refunds')
      .update({
        xero_credit_note_id: createdCreditNote.creditNoteID,
        xero_synced: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', data.refund_id)

    if (updateError) {
      console.error('Failed to update refund with Xero credit note ID:', updateError)
      // Don't fail the whole operation, credit note was created successfully
    }

    logXeroSync('credit-note-created', 'Credit note created successfully', {
      refundId: data.refund_id,
      xeroCreditNoteId: createdCreditNote.creditNoteID,
      creditNoteNumber: createdCreditNote.creditNoteNumber,
      amount: createdCreditNote.total
    })

    return {
      success: true,
      creditNoteId: createdCreditNote.creditNoteID,
      xeroCreditNote: createdCreditNote
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    logXeroSync('credit-note-error', 'Failed to create credit note', {
      refundId: data.refund_id,
      error: errorMessage
    })

    // Update refund record with sync error
    try {
      const supabase = await createClient()
      await supabase
        .from('refunds')
        .update({
          xero_sync_error: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', data.refund_id)
    } catch (dbError) {
      console.error('Failed to update refund with sync error:', dbError)
    }

    // Report to Sentry
    Sentry.captureException(error, {
      tags: { operation: 'xero_credit_note_creation' },
      extra: {
        refundId: data.refund_id,
        paymentId: data.payment_id,
        userId: data.user_id
      }
    })

    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Build credit note line items based on original invoice line items
 * This ensures proper accounting code allocation for refunds
 */
export async function buildCreditNoteLineItems(
  paymentId: string,
  refundAmount: number
): Promise<Array<{
  description: string
  amount: number
  account_code: string
  tax_type?: string
}>> {
  try {
    const supabase = await createClient()

    // Get the original invoice line items
    const { data: invoice, error } = await supabase
      .from('xero_invoices')
      .select(`
        *,
        xero_invoice_line_items (
          description,
          line_amount,
          account_code,
          tax_type,
          line_item_type
        )
      `)
      .eq('payment_id', paymentId)
      .single()

    if (error || !invoice || !invoice.xero_invoice_line_items) {
      // Fallback: create a generic refund line item
      return [{
        description: `Refund for Payment ${paymentId.slice(0, 8)}`,
        amount: refundAmount,
        account_code: '400', // Default sales account
        tax_type: 'NONE'
      }]
    }

    const originalLineItems = invoice.xero_invoice_line_items
    const totalInvoiceAmount = originalLineItems.reduce((sum: number, item: any) => sum + item.line_amount, 0)

    // Proportionally allocate refund amount across original line items
    const creditLineItems = originalLineItems.map((item: any) => {
      const proportion = Math.abs(item.line_amount) / totalInvoiceAmount
      const creditAmount = Math.round(refundAmount * proportion)

      return {
        description: `Refund: ${item.description}`,
        amount: creditAmount,
        account_code: item.account_code,
        tax_type: item.tax_type || 'NONE'
      }
    })

    // Ensure the total matches exactly (handle rounding differences)
    const totalAllocated = creditLineItems.reduce((sum, item) => sum + item.amount, 0)
    const difference = refundAmount - totalAllocated

    if (difference !== 0 && creditLineItems.length > 0) {
      // Add/subtract the difference to the largest line item
      const largestItem = creditLineItems.reduce((max, item) => 
        item.amount > max.amount ? item : max
      )
      largestItem.amount += difference
    }

    return creditLineItems

  } catch (error) {
    console.error('Error building credit note line items:', error)
    
    // Fallback: create a generic refund line item
    return [{
      description: `Refund for Payment ${paymentId.slice(0, 8)}`,
      amount: refundAmount,
      account_code: '400', // Default sales account
      tax_type: 'NONE'
    }]
  }
}

/**
 * Process a refund with Xero credit note creation
 * This is called after a successful Stripe refund
 */
export async function processRefundWithXero(refundId: string): Promise<void> {
  try {
    const supabase = await createClient()

    // Get refund details with payment and invoice info
    const { data: refund, error } = await supabase
      .from('refunds')
      .select(`
        *,
        payments!inner (
          id,
          user_id,
          final_amount,
          xero_invoices!left (
            id,
            xero_invoice_id,
            invoice_number
          )
        )
      `)
      .eq('id', refundId)
      .single()

    if (error || !refund) {
      throw new Error(`Refund not found: ${refundId}`)
    }

    // Skip if already synced to Xero
    if (refund.xero_synced) {
      console.log(`Refund ${refundId} already synced to Xero`)
      return
    }

    // Skip if refund is not completed
    if (refund.status !== 'completed') {
      console.log(`Refund ${refundId} not completed, skipping Xero sync`)
      return
    }

    // Build line items based on original invoice
    const lineItems = await buildCreditNoteLineItems(
      refund.payment_id,
      refund.amount
    )

    // Prepare credit note data
    const creditNoteData: RefundCreditNoteData = {
      refund_id: refund.id,
      payment_id: refund.payment_id,
      user_id: refund.payments.user_id,
      refund_amount: refund.amount,
      reason: refund.reason || undefined,
      original_invoice_id: refund.payments.xero_invoices?.[0]?.xero_invoice_id,
      line_items: lineItems
    }

    // Create credit note in Xero
    const result = await createXeroCreditNote(creditNoteData)

    if (!result.success) {
      throw new Error(result.error || 'Failed to create Xero credit note')
    }

    logXeroSync('refund-xero-sync-complete', 'Refund successfully synced to Xero', {
      refundId,
      xeroCreditNoteId: result.creditNoteId
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    logXeroSync('refund-xero-sync-error', 'Failed to sync refund to Xero', {
      refundId,
      error: errorMessage
    })

    // Update refund with error
    try {
      const supabase = await createClient()
      await supabase
        .from('refunds')
        .update({
          xero_sync_error: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', refundId)
    } catch (dbError) {
      console.error('Failed to update refund with Xero sync error:', dbError)
    }

    throw error
  }
}