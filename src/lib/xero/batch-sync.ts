/**
 * Xero Batch Sync Manager
 * 
 * Handles syncing staged records to Xero API with retry logic and error handling
 */

import { Invoice, LineItem, Payment, CurrencyCode } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './client'
import { getOrCreateXeroContact } from './contacts'
import { createAdminClient } from '../supabase/server'
import { Database } from '../../types/database'
import { batchProcessor } from '../batch-processor'
import * as Sentry from '@sentry/nextjs'
import { getActiveXeroTenants, validateXeroConnection } from './client'

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
      // Check if Xero is connected before attempting any sync
      const activeTenants = await getActiveXeroTenants()
      if (activeTenants.length === 0) {
        console.log('⚠️ No active Xero tenants found - skipping sync to preserve pending status')
        return results
      }

      // Validate connection to at least one tenant
      let hasValidConnection = false
      for (const tenant of activeTenants) {
        const isValid = await validateXeroConnection(tenant.tenant_id)
        if (isValid) {
          hasValidConnection = true
          break
        }
      }

      if (!hasValidConnection) {
        console.log('⚠️ No valid Xero connections found - skipping sync to preserve pending status')
        return results
      }

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
    let activeTenant: { tenant_id: string; tenant_name: string; expires_at: string } | null = null
    
    try {
      console.log('📄 Syncing invoice to Xero:', {
        id: invoiceRecord.id,
        invoiceNumber: invoiceRecord.invoice_number,
        tenantId: invoiceRecord.tenant_id,
        syncStatus: invoiceRecord.sync_status,
        paymentId: invoiceRecord.payment_id
      })

      // Get the active tenant for Xero sync
      const { getActiveTenant } = await import('./client')
      activeTenant = await getActiveTenant()
      
      if (!activeTenant) {
        console.log('❌ No active Xero tenant available for sync')
        // Don't mark as failed - leave as pending for when Xero is reconnected
        return false
      }

      console.log('🏢 Using active tenant for sync:', activeTenant.tenant_name)

      // Get authenticated Xero client using active tenant
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        // Don't mark as failed - leave as pending for when Xero is reconnected
        console.log('⚠️ Unable to authenticate with Xero - leaving invoice as pending:', invoiceRecord.invoice_number)
        return false
      }

      // Get or create contact in Xero
      const metadata = invoiceRecord.staging_metadata as any
      console.log('👤 Getting/creating Xero contact for user:', metadata?.user_id)
      const contactResult = await getOrCreateXeroContact(metadata.user_id, activeTenant.tenant_id)
      console.log('👤 Contact result:', contactResult)
      
      if (!contactResult.success || !contactResult.xeroContactId) {
        console.log('❌ Contact sync failed:', contactResult.error)
        await this.markInvoiceAsFailed(invoiceRecord.id, 'Failed to get/create Xero contact')
        return false
      }

      // Check if this is a zero-value invoice (always AUTHORISED)
      if (invoiceRecord.net_amount === 0) {
        console.log('✅ Zero-value invoice - marking as AUTHORISED')
        // Zero-value invoices are always AUTHORISED, no need to check payment status
      } else {
        // Non-zero invoices need payment verification
        if (!invoiceRecord.payment_id) {
          console.log('⚠️ No payment_id on non-zero invoice - skipping sync')
          return false
        }

        // Get payment status
        const { data: payment } = await this.supabase
          .from('payments')
          .select('status')
          .eq('id', invoiceRecord.payment_id)
          .single()

        if (!payment) {
          console.log('⚠️ No payment record found - skipping sync')
          return false
        }

        console.log('💰 Payment status:', payment.status, 'for invoice:', invoiceRecord.invoice_number)
        
        if (payment.status !== 'completed') {
          // Non-zero invoices with pending/failed payments should not be synced
          console.log('⏸️ Non-zero invoice with pending/failed payment - skipping sync')
          return false
        }

        console.log('✅ Completed payment - marking as AUTHORISED')
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

      console.log('📋 Line items prepared:', lineItems.length, 'items')

      // Create invoice object
      const invoice: Invoice = {
        type: Invoice.TypeEnum.ACCREC,
        contact: {
          contactID: contactResult.xeroContactId
        },
        lineItems,
        date: new Date(invoiceRecord.created_at).toISOString().split('T')[0], // YYYY-MM-DD format
        dueDate: new Date(new Date(invoiceRecord.created_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from creation
        // Let Xero generate its own invoice number - don't set invoiceNumber here
        reference: metadata.stripe_payment_intent_id || '',        
        status: Invoice.StatusEnum.AUTHORISED,
        currencyCode: CurrencyCode.USD
      }

      console.log('📤 Creating invoice in Xero...')
      // Create invoice in Xero
      const response = await xeroApi.accountingApi.createInvoices(
        activeTenant.tenant_id,
        { invoices: [invoice] }
      )

      console.log('📥 Xero API response received:', {
        hasInvoices: !!response.body.invoices,
        invoiceCount: response.body.invoices?.length || 0
      })

      if (response.body.invoices && response.body.invoices.length > 0) {
        const xeroInvoice = response.body.invoices[0]
        console.log('📄 Xero invoice created:', {
          xeroInvoiceId: xeroInvoice.invoiceID,
          xeroInvoiceNumber: xeroInvoice.invoiceNumber,
          status: xeroInvoice.status
        })
        
        if (xeroInvoice.invoiceID && xeroInvoice.invoiceNumber) {
          console.log('✅ Marking invoice as synced...')
          // Update staging record with Xero IDs
          await this.markInvoiceAsSynced(
            invoiceRecord.id,
            xeroInvoice.invoiceID,
            xeroInvoice.invoiceNumber,
            activeTenant.tenant_id
          )

          // Log success
          await logXeroSync({
            tenant_id: activeTenant.tenant_id,
            operation: 'create_invoice',
            record_type: 'invoice',
            record_id: invoiceRecord.id,
            xero_id: xeroInvoice.invoiceID,
            success: true,
            details: `Invoice ${xeroInvoice.invoiceNumber} created successfully`
          })

          console.log('✅ Invoice synced successfully:', xeroInvoice.invoiceNumber)
          return true
        } else {
          console.log('❌ Missing Xero invoice ID or number:', {
            xeroInvoiceId: xeroInvoice.invoiceID,
            xeroInvoiceNumber: xeroInvoice.invoiceNumber
          })
        }
      }

      console.log('❌ Invalid response from Xero API')
      await this.markInvoiceAsFailed(invoiceRecord.id, 'Invalid response from Xero API')
      return false

    } catch (error) {
      console.error('❌ Error syncing invoice to Xero:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.markInvoiceAsFailed(invoiceRecord.id, errorMessage)
      
      // Log to Xero sync logs
      await logXeroSync({
        tenant_id: activeTenant?.tenant_id || '',
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

      if (!invoiceRecord || !invoiceRecord.xero_invoice_id) {
        await this.markPaymentAsFailed(paymentRecord.id, 'Associated invoice not synced to Xero yet')
        return false
      }

      // Check if tenant_id is available
      if (!paymentRecord.tenant_id) {
        await this.markPaymentAsFailed(paymentRecord.id, 'No tenant_id available for Xero sync')
        return false
      }

      // Get authenticated Xero client
      const xeroApi = await getAuthenticatedXeroClient(paymentRecord.tenant_id)
      if (!xeroApi) {
        // Don't mark as failed - leave as pending for when Xero is reconnected
        console.log('⚠️ Unable to authenticate with Xero - leaving payment as pending:', paymentRecord.id)
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
        tenant_id: paymentRecord.tenant_id || '',
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
    invoiceNumber: string,
    tenantId?: string
  ) {
    console.log('💾 Marking invoice as synced:', {
      stagingId,
      xeroInvoiceId,
      invoiceNumber,
      tenantId
    })
    
    const updateData: any = {
      xero_invoice_id: xeroInvoiceId,
      invoice_number: invoiceNumber,
      invoice_status: 'AUTHORISED', // Any synced invoice should be AUTHORISED
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      sync_error: null
    }

    // Set tenant_id if provided (for records that were staged without tenant_id)
    if (tenantId) {
      updateData.tenant_id = tenantId
    }
    
    const { data, error } = await this.supabase
      .from('xero_invoices')
      .update(updateData)
      .eq('id', stagingId)
      .select('id, sync_status')

    if (error) {
      console.error('❌ Error marking invoice as synced:', error)
    } else {
      console.log('✅ Invoice marked as synced successfully:', data)
    }
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