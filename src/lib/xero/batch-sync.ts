/**
 * Xero Batch Sync Manager
 * 
 * Handles syncing staged records to Xero API with retry logic and error handling
 */

import { Invoice, LineItem, Payment, CurrencyCode } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './client'
import { getOrCreateXeroContact } from './contacts'
import { createAdminClient } from '../supabase/server'
import { Database } from '@/types/database'
import { batchProcessor } from '../batch-processor'
import * as Sentry from '@sentry/nextjs'

type XeroInvoiceRecord = Database['public']['Tables']['xero_invoices']['Row'] & {
  xero_invoice_line_items: Database['public']['Tables']['xero_invoice_line_items']['Row'][]
}

type XeroPaymentRecord = Database['public']['Tables']['xero_payments']['Row']

export class XeroBatchSyncManager {
  private supabase: ReturnType<typeof createAdminClient>

  constructor() {
    this.supabase = createAdminClient()
  }

  /**
   * Sync all pending invoices and payments with intelligent batching
   */
  async syncAllPendingRecords(): Promise<{
    invoices: { synced: number; failed: number }
    payments: { synced: number; failed: number }
  }> {
    console.log('🔄 Starting intelligent batch sync of pending Xero records...')

    const results = {
      invoices: { synced: 0, failed: 0 },
      payments: { synced: 0, failed: 0 }
    }

    try {
      // Get pending records, prioritizing older records first
      const { data: pendingInvoices } = await this.supabase
        .from('xero_invoices')
        .select(`
          *,
          xero_invoice_line_items (*)
        `)
        .in('sync_status', ['pending', 'staged'])
        .order('staged_at', { ascending: true })

      const { data: pendingPayments } = await this.supabase
        .from('xero_payments')
        .select('*')
        .in('sync_status', ['pending', 'staged'])
        .order('staged_at', { ascending: true })

      console.log(`📋 Found ${pendingInvoices?.length || 0} pending invoices, ${pendingPayments?.length || 0} pending payments`)

      // Sync invoices first using intelligent batch processing
      if (pendingInvoices?.length) {
        const invoiceResults = await batchProcessor.processBatch(
          pendingInvoices as XeroInvoiceRecord[],
          (invoice) => this.syncSingleInvoice(invoice),
          {
            batchSize: 5,              // Process 5 invoices at a time
            concurrency: 2,            // Max 2 concurrent API calls
            delayBetweenBatches: 200,  // 200ms between batches
            retryFailures: true,       // Enable intelligent retry
            operationType: 'xero_api'  // Use Xero-specific retry strategy
          }
        )

        results.invoices.synced = invoiceResults.successful.length
        results.invoices.failed = invoiceResults.failed.length

        // Log failed invoices for admin review
        if (invoiceResults.failed.length > 0) {
          console.log('❌ Failed invoice syncs:', invoiceResults.failed.map(f => ({
            invoice: f.item.invoice_number,
            error: f.error
          })))
        }
      }

      // Sync payments after invoices (they depend on invoice sync completion)
      if (pendingPayments?.length) {
        const paymentResults = await batchProcessor.processBatch(
          pendingPayments,
          (payment) => this.syncSinglePayment(payment),
          {
            batchSize: 8,              // Process more payments at once
            concurrency: 3,            // Slightly higher concurrency for payments
            delayBetweenBatches: 150,  // Shorter delay between payment batches
            retryFailures: true,
            operationType: 'xero_api'
          }
        )

        results.payments.synced = paymentResults.successful.length
        results.payments.failed = paymentResults.failed.length

        // Log failed payments for admin review
        if (paymentResults.failed.length > 0) {
          console.log('❌ Failed payment syncs:', paymentResults.failed.map(f => ({
            payment: f.item.id,
            error: f.error
          })))
        }
      }

      console.log('✅ Intelligent batch sync completed:', results)
      return results

    } catch (error) {
      console.error('❌ Error in batch sync:', error)
      await Sentry.captureException(error, {
        tags: { component: 'xero-batch-sync', feature: 'intelligent-batching' }
      })
      return results
    }
  }

  /**
   * Wrapper for batch processing - sync single invoice
   */
  private async syncSingleInvoice(invoiceRecord: XeroInvoiceRecord): Promise<boolean> {
    return this.syncInvoiceToXero(invoiceRecord)
  }

  /**
   * Wrapper for batch processing - sync single payment
   */
  private async syncSinglePayment(paymentRecord: XeroPaymentRecord): Promise<boolean> {
    return this.syncPaymentToXero(paymentRecord)
  }

  /**
   * Sync a single invoice to Xero (core implementation)
   */
  async syncInvoiceToXero(invoiceRecord: XeroInvoiceRecord): Promise<boolean> {
    try {
      console.log('📄 Syncing invoice to Xero:', invoiceRecord.invoice_number)

      // Get authenticated Xero client
      const xeroApi = await getAuthenticatedXeroClient(invoiceRecord.tenant_id)
      if (!xeroApi) {
        await this.markInvoiceAsFailed(invoiceRecord.id, 'Unable to authenticate with Xero')
        return false
      }

      // Get or create contact in Xero
      const metadata = invoiceRecord.staging_metadata as any
      const contactResult = await getOrCreateXeroContact(metadata.user_id, invoiceRecord.tenant_id)
      
      if (!contactResult.success || !contactResult.xeroContactId) {
        await this.markInvoiceAsFailed(invoiceRecord.id, 'Failed to get/create Xero contact')
        return false
      }

      // Convert line items to Xero format
      const lineItems: LineItem[] = invoiceRecord.xero_invoice_line_items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unit_amount / 100, // Convert cents to dollars
        accountCode: item.account_code || undefined,
        taxType: item.tax_type || 'NONE',
        lineAmount: item.line_amount / 100 // Convert cents to dollars
      }))

      // Create invoice object
      const invoice: Invoice = {
        type: Invoice.TypeEnum.ACCREC,
        contact: {
          contactID: contactResult.xeroContactId
        },
        lineItems,
        date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        invoiceNumber: invoiceRecord.invoice_number,
        reference: metadata.stripe_payment_intent_id || '',
        status: invoiceRecord.net_amount === 0 ? Invoice.StatusEnum.AUTHORISED : Invoice.StatusEnum.DRAFT,
        currencyCode: CurrencyCode.USD
      }

      // Create invoice in Xero
      const response = await xeroApi.accountingApi.createInvoices(
        invoiceRecord.tenant_id,
        { invoices: [invoice] }
      )

      if (response.body.invoices && response.body.invoices.length > 0) {
        const xeroInvoice = response.body.invoices[0]
        
        if (xeroInvoice.invoiceID && xeroInvoice.invoiceNumber) {
          // Update staging record with Xero IDs
          await this.markInvoiceAsSynced(
            invoiceRecord.id,
            xeroInvoice.invoiceID,
            xeroInvoice.invoiceNumber
          )

          // Log success
          await logXeroSync({
            tenant_id: invoiceRecord.tenant_id,
            operation: 'create_invoice',
            record_type: 'invoice',
            record_id: invoiceRecord.id,
            xero_id: xeroInvoice.invoiceID,
            success: true,
            details: `Invoice ${xeroInvoice.invoiceNumber} created successfully`
          })

          console.log('✅ Invoice synced successfully:', xeroInvoice.invoiceNumber)
          return true
        }
      }

      await this.markInvoiceAsFailed(invoiceRecord.id, 'Invalid response from Xero API')
      return false

    } catch (error) {
      console.error('❌ Error syncing invoice to Xero:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.markInvoiceAsFailed(invoiceRecord.id, errorMessage)
      
      // Log to Xero sync logs
      await logXeroSync({
        tenant_id: invoiceRecord.tenant_id,
        operation: 'create_invoice',
        record_type: 'invoice',
        record_id: invoiceRecord.id,
        success: false,
        error_message: errorMessage
      })

      return false
    }
  }

  /**
   * Sync a single payment to Xero
   */
  async syncPaymentToXero(paymentRecord: XeroPaymentRecord): Promise<boolean> {
    try {
      console.log('💰 Syncing payment to Xero for invoice:', paymentRecord.xero_invoice_id)

      // Get the associated invoice record
      const { data: invoiceRecord } = await this.supabase
        .from('xero_invoices')
        .select('xero_invoice_id, tenant_id')
        .eq('id', paymentRecord.xero_invoice_id)
        .single()

      if (!invoiceRecord || !invoiceRecord.xero_invoice_id || invoiceRecord.xero_invoice_id === '00000000-0000-0000-0000-000000000000') {
        await this.markPaymentAsFailed(paymentRecord.id, 'Associated invoice not synced to Xero yet')
        return false
      }

      // Get authenticated Xero client
      const xeroApi = await getAuthenticatedXeroClient(paymentRecord.tenant_id)
      if (!xeroApi) {
        await this.markPaymentAsFailed(paymentRecord.id, 'Unable to authenticate with Xero')
        return false
      }

      // Create payment object
      const payment: Payment = {
        invoice: {
          invoiceID: invoiceRecord.xero_invoice_id
        },
        account: {
          code: paymentRecord.bank_account_code || 'STRIPE'
        },
        amount: paymentRecord.amount_paid / 100, // Convert cents to dollars
        date: new Date().toISOString().split('T')[0],
        reference: paymentRecord.reference || ''
      }

      // Create payment in Xero
      const response = await xeroApi.accountingApi.createPayments(
        paymentRecord.tenant_id,
        { payments: [payment] }
      )

      if (response.body.payments && response.body.payments.length > 0) {
        const xeroPayment = response.body.payments[0]
        
        if (xeroPayment.paymentID) {
          // Update staging record with Xero ID
          await this.markPaymentAsSynced(paymentRecord.id, xeroPayment.paymentID)

          // Log success
          await logXeroSync({
            tenant_id: paymentRecord.tenant_id,
            operation: 'create_payment',
            record_type: 'payment',
            record_id: paymentRecord.id,
            xero_id: xeroPayment.paymentID,
            success: true,
            details: `Payment ${xeroPayment.paymentID} created successfully`
          })

          console.log('✅ Payment synced successfully:', xeroPayment.paymentID)
          return true
        }
      }

      await this.markPaymentAsFailed(paymentRecord.id, 'Invalid response from Xero API')
      return false

    } catch (error) {
      console.error('❌ Error syncing payment to Xero:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.markPaymentAsFailed(paymentRecord.id, errorMessage)
      
      // Log to Xero sync logs
      await logXeroSync({
        tenant_id: paymentRecord.tenant_id,
        operation: 'create_payment',
        record_type: 'payment',
        record_id: paymentRecord.id,
        success: false,
        error_message: errorMessage
      })

      return false
    }
  }

  /**
   * Mark invoice as successfully synced
   */
  private async markInvoiceAsSynced(
    stagingId: string, 
    xeroInvoiceId: string, 
    invoiceNumber: string
  ) {
    await this.supabase
      .from('xero_invoices')
      .update({
        xero_invoice_id: xeroInvoiceId,
        invoice_number: invoiceNumber,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        sync_error: null
      })
      .eq('id', stagingId)
  }

  /**
   * Mark invoice as failed
   */
  private async markInvoiceAsFailed(stagingId: string, error: string) {
    await this.supabase
      .from('xero_invoices')
      .update({
        sync_status: 'failed',
        sync_error: error,
        last_synced_at: new Date().toISOString()
      })
      .eq('id', stagingId)
  }

  /**
   * Mark payment as successfully synced
   */
  private async markPaymentAsSynced(stagingId: string, xeroPaymentId: string) {
    await this.supabase
      .from('xero_payments')
      .update({
        xero_payment_id: xeroPaymentId,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        sync_error: null
      })
      .eq('id', stagingId)
  }

  /**
   * Mark payment as failed
   */
  private async markPaymentAsFailed(stagingId: string, error: string) {
    await this.supabase
      .from('xero_payments')
      .update({
        sync_status: 'failed',
        sync_error: error,
        last_synced_at: new Date().toISOString()
      })
      .eq('id', stagingId)
  }

}

// Export singleton instance
export const xeroBatchSyncManager = new XeroBatchSyncManager()