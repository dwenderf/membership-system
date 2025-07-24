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
   * Centralized function to get pending Xero records with consistent filtering
   * 
   * This ensures all parts of the system use the same criteria for determining
   * which records are ready to sync.
   */
  async getPendingXeroRecords(): Promise<{
    invoices: XeroInvoiceRecord[]
    payments: XeroPaymentRecord[]
  }> {
    try {
      // Get pending invoices (only 'pending' - staged invoices are not ready until payment succeeds)
      const { data: pendingInvoices } = await this.supabase
        .from('xero_invoices')
        .select(`
          *,
          xero_invoice_line_items (*)
        `)
        .eq('sync_status', 'pending')
        .order('staged_at', { ascending: true })

      // Get pending payments with payment data for filtering (only 'pending' - staged payments are not ready)
      const { data: pendingPayments } = await this.supabase
        .from('xero_payments')
        .select(`
          *,
          xero_invoices (
            payment_id,
            payments (
              status,
              payment_method
            )
          )
        `)
        .eq('sync_status', 'pending')
        .order('staged_at', { ascending: true })

      // Filter payments based on criteria: completed status and non-free payment method
      const eligiblePayments = pendingPayments?.filter(payment => {
        const invoice = Array.isArray(payment.xero_invoices) ? payment.xero_invoices[0] : payment.xero_invoices
        const linkedPayment = invoice?.payments ? (Array.isArray(invoice.payments) ? invoice.payments[0] : invoice.payments) : null
        
        if (!linkedPayment) {
          console.log(`⚠️ Payment ${payment.id} has no linked payment record - skipping`)
          return false
        }
        
        if (linkedPayment.status !== 'completed') {
          console.log(`⚠️ Payment ${payment.id} has non-completed status (${linkedPayment.status}) - skipping`)
          return false
        }
        
        if (linkedPayment.payment_method === 'free') {
          console.log(`⚠️ Payment ${payment.id} is free payment - skipping`)
          return false
        }
        
        return true
      }) || []

      return {
        invoices: pendingInvoices || [],
        payments: eligiblePayments
      }
    } catch (error) {
      console.error('❌ Error getting pending Xero records:', error)
      return {
        invoices: [],
        payments: []
      }
    }
  }

  /**
   * Get count of pending Xero records (for efficiency when only count is needed)
   */
  async getPendingXeroCount(): Promise<number> {
    const { invoices, payments } = await this.getPendingXeroRecords()
    return (invoices?.length || 0) + (payments?.length || 0)
  }

  /**
   * Sync all pending invoices and payments with intelligent batching
   */
  async syncAllPendingRecords(): Promise<{
    invoices: { synced: number; failed: number }
    payments: { synced: number; failed: number }
  }> {
    const startTime = Date.now()
    console.log('🔄 Starting intelligent batch sync of pending Xero records...')

    const results = {
      invoices: { synced: 0, failed: 0 },
      payments: { synced: 0, failed: 0 }
    }

    try {
      // Phase 1: Check for pending records using centralized function
      console.log('📋 Phase 1: Checking for pending records...')
      const { invoices: pendingInvoices, payments: filteredPayments } = await this.getPendingXeroRecords()

      console.log(`📊 Found ${pendingInvoices?.length || 0} pending invoices, ${filteredPayments.length} eligible payments`)

      // If no pending records, skip Xero connection entirely
      if ((!pendingInvoices || pendingInvoices.length === 0) && 
          (!filteredPayments || filteredPayments.length === 0)) {
        console.log('✅ No pending records to sync - skipping Xero connection')
        return results
      }

      // Phase 2: Connect to Xero
      console.log('🔌 Phase 2: Connecting to Xero...')
      
      // Check if Xero is connected before attempting any sync
      const activeTenants = await getActiveXeroTenants()
      if (activeTenants.length === 0) {
        console.log('⚠️ No active Xero tenants found - skipping sync to preserve pending status')
        return results
      }

      console.log(`🏢 Found ${activeTenants.length} active Xero tenant(s)`)

      // Validate connection to at least one tenant
      let hasValidConnection = false
      let validTenant = null
      for (const tenant of activeTenants) {
        console.log(`🔍 Validating connection to tenant: ${tenant.tenant_name} (${tenant.tenant_id})`)
        const isValid = await validateXeroConnection(tenant.tenant_id)
        if (isValid) {
          hasValidConnection = true
          validTenant = tenant
          console.log(`✅ Valid connection to tenant: ${tenant.tenant_name}`)
          break
        } else {
          console.log(`❌ Invalid connection to tenant: ${tenant.tenant_name}`)
        }
      }

      if (!hasValidConnection) {
        console.log('⚠️ No valid Xero connections found - skipping sync to preserve pending status')
        return results
      }

      console.log(`✅ Xero connection validated - using tenant: ${validTenant?.tenant_name}`)

      // Phase 3: Sync invoices
      if (pendingInvoices?.length) {
        console.log(`📄 Phase 3: Syncing ${pendingInvoices.length} invoices...`)
        const invoiceStartTime = Date.now()
        
        const invoiceResults = await batchProcessor.processBatch(
          pendingInvoices as XeroInvoiceRecord[],
          (invoice) => this.syncSingleInvoice(invoice),
          {
            batchSize: 50,             // Process 50 invoices at a time (was 10)
            concurrency: 10,           // Max 10 concurrent API calls (was 5)
            delayBetweenBatches: 100,  // 100ms between batches (was 200ms)
            retryFailures: false,      // No retries - let cron handle failures
            operationType: 'xero_api'  // Use Xero-specific settings
          }
        )

        const invoiceDuration = Date.now() - invoiceStartTime
        results.invoices.synced = invoiceResults.successful.length
        results.invoices.failed = invoiceResults.failed.length

        console.log(`📊 Invoice sync completed in ${invoiceDuration}ms:`, {
          total: pendingInvoices.length,
          successful: invoiceResults.successful.length,
          failed: invoiceResults.failed.length,
          duration: invoiceDuration,
          averageTime: invoiceDuration / pendingInvoices.length
        })

        // Log failed invoices for admin review
        if (invoiceResults.failed.length > 0) {
          console.log('❌ Failed invoice syncs:', invoiceResults.failed.map(f => ({
            invoice: f.item.invoice_number,
            error: f.error
          })))
        }
      }

      // Phase 4: Sync payments
      if (filteredPayments?.length) {
        console.log(`💰 Phase 4: Syncing ${filteredPayments.length} eligible payments...`)
        const paymentStartTime = Date.now()
        
        const paymentResults = await batchProcessor.processBatch(
          filteredPayments,
          (payment) => this.syncSinglePayment(payment),
          {
            batchSize: 50,             // Process 50 payments at once (was 15)
            concurrency: 15,           // Higher concurrency for payments (was 8)
            delayBetweenBatches: 75,   // Shorter delay between payment batches (was 150ms)
            retryFailures: false,      // No retries - let cron handle failures
            operationType: 'xero_api'
          }
        )

        const paymentDuration = Date.now() - paymentStartTime
        results.payments.synced = paymentResults.successful.length
        results.payments.failed = paymentResults.failed.length

        console.log(`📊 Payment sync completed in ${paymentDuration}ms:`, {
          total: filteredPayments.length,
          successful: paymentResults.successful.length,
          failed: paymentResults.failed.length,
          duration: paymentDuration,
          averageTime: paymentDuration / filteredPayments.length
        })

        // Log failed payments for admin review
        if (paymentResults.failed.length > 0) {
          console.log('❌ Failed payment syncs:', paymentResults.failed.map(f => ({
            payment: f.item.id,
            error: f.error
          })))
        }
      }

      const totalDuration = Date.now() - startTime
      console.log('✅ Intelligent batch sync completed:', {
        ...results,
        totalDuration,
        totalRecords: (pendingInvoices?.length || 0) + (filteredPayments?.length || 0),
        totalSuccessful: results.invoices.synced + results.payments.synced,
        totalFailed: results.invoices.failed + results.payments.failed
      })
      
      return results

    } catch (error) {
      const totalDuration = Date.now() - startTime
      console.error('❌ Error in batch sync:', error)
      console.error(`❌ Batch sync failed after ${totalDuration}ms`)
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
        paymentId: invoiceRecord.payment_id,
        netAmount: invoiceRecord.net_amount
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

      // Get user data for enhanced logging (contact name)
      const { data: userData } = await this.supabase
        .from('users')
        .select('first_name, last_name, member_id')
        .eq('id', metadata.user_id)
        .single()
      
      const contactName = userData 
        ? userData.member_id 
          ? `${userData.first_name} ${userData.last_name} - ${userData.member_id}`
          : `${userData.first_name} ${userData.last_name}`
        : 'Unknown Contact'

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
            operation: 'invoice_sync',
            record_type: 'invoice',
            record_id: invoiceRecord.id,
            xero_id: xeroInvoice.invoiceID,
            success: true,
            details: `Invoice ${xeroInvoice.invoiceNumber} created successfully`,
            response_data: {
              invoice: {
                invoiceID: xeroInvoice.invoiceID,
                invoiceNumber: xeroInvoice.invoiceNumber,
                status: xeroInvoice.status,
                type: xeroInvoice.type,
                total: xeroInvoice.total,
                subTotal: xeroInvoice.subTotal,
                date: xeroInvoice.date,
                dueDate: xeroInvoice.dueDate,
                currencyCode: xeroInvoice.currencyCode,
                lineAmountTypes: xeroInvoice.lineAmountTypes
              }
            },
            request_data: {
              invoice: {
                type: invoice.type,
                contact: { 
                  contactID: contactResult.xeroContactId,
                  contactName: contactName
                },
                lineItems: invoice.lineItems,
                date: invoice.date,
                dueDate: invoice.dueDate,
                reference: invoice.reference,
                status: invoice.status,
                currencyCode: invoice.currencyCode
              }
            }
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
      
      // Check if this is a rate limit error
      const isRateLimitError = this.isRateLimitError(error)
      
      if (isRateLimitError) {
        console.log('🚫 Rate limit exceeded - leaving invoice as pending for retry')
        // Don't mark as failed - leave as pending so it can be retried later
        return false
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.markInvoiceAsFailed(invoiceRecord.id, errorMessage)
      
      // Log to Xero sync logs
      await logXeroSync({
        tenant_id: activeTenant?.tenant_id || '',
        operation: 'invoice_sync',
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
      console.log('💰 Syncing payment to Xero:', {
        id: paymentRecord.id,
        xeroInvoiceId: paymentRecord.xero_invoice_id,
        amountPaid: paymentRecord.amount_paid,
        reference: paymentRecord.reference,
        bankAccountCode: paymentRecord.bank_account_code
      })

      // Get the associated invoice record
      const { data: invoiceRecord } = await this.supabase
        .from('xero_invoices')
        .select('xero_invoice_id, tenant_id')
        .eq('id', paymentRecord.xero_invoice_id)
        .single()

      if (!invoiceRecord || !invoiceRecord.xero_invoice_id) {
        console.log('❌ Associated invoice not synced to Xero yet - skipping payment')
        await this.markPaymentAsFailed(paymentRecord.id, 'Associated invoice not synced to Xero yet')
        return false
      }

      console.log('📄 Found associated invoice:', invoiceRecord.xero_invoice_id)

      // Check if tenant_id is available
      if (!paymentRecord.tenant_id) {
        console.log('❌ No tenant_id available for Xero sync')
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

      console.log('📤 Creating payment in Xero:', {
        invoiceId: invoiceRecord.xero_invoice_id,
        amount: payment.amount,
        accountCode: payment.account?.code || 'STRIPE',
        reference: payment.reference
      })

      // Create payment in Xero
      const response = await xeroApi.accountingApi.createPayments(
        paymentRecord.tenant_id,
        { payments: [payment] }
      )

      console.log('📥 Xero payment API response received:', {
        hasPayments: !!response.body.payments,
        paymentCount: response.body.payments?.length || 0
      })

      if (response.body.payments && response.body.payments.length > 0) {
        const xeroPayment = response.body.payments[0]
        console.log('💰 Xero payment created:', {
          xeroPaymentId: xeroPayment.paymentID,
          amount: xeroPayment.amount,
          status: xeroPayment.status
        })
        
        if (xeroPayment.paymentID) {
          console.log('✅ Marking payment as synced...')
          // Update staging record with Xero ID
          await this.markPaymentAsSynced(paymentRecord.id, xeroPayment.paymentID)

          // Log success
          await logXeroSync({
            tenant_id: paymentRecord.tenant_id,
            operation: 'payment_sync',
            record_type: 'payment',
            record_id: paymentRecord.id,
            xero_id: xeroPayment.paymentID,
            success: true,
            details: `Payment ${xeroPayment.paymentID} created successfully`,
            response_data: {
              payment: {
                paymentID: xeroPayment.paymentID,
                date: xeroPayment.date,
                amount: xeroPayment.amount,
                reference: xeroPayment.reference,
                currencyRate: xeroPayment.currencyRate,
                paymentType: xeroPayment.paymentType,
                status: xeroPayment.status,
                invoice: xeroPayment.invoice
              }
            },
            request_data: {
              payment: {
                invoice: { invoiceID: invoiceRecord.xero_invoice_id },
                account: { code: paymentRecord.bank_account_code || 'STRIPE' },
                amount: paymentRecord.amount_paid / 100,
                date: payment.date,
                reference: payment.reference
              }
            }
          })

          console.log('✅ Payment synced successfully:', xeroPayment.paymentID)
          return true
        }
      }

      console.log('❌ Invalid response from Xero payment API')
      await this.markPaymentAsFailed(paymentRecord.id, 'Invalid response from Xero API')
      return false

    } catch (error) {
      console.error('❌ Error syncing payment to Xero:', error)
      
      // Check if this is a rate limit error
      const isRateLimitError = this.isRateLimitError(error)
      
      if (isRateLimitError) {
        console.log('🚫 Rate limit exceeded - leaving payment as pending for retry')
        // Don't mark as failed - leave as pending so it can be retried later
        return false
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.markPaymentAsFailed(paymentRecord.id, errorMessage)
      
      // Log to Xero sync logs
      await logXeroSync({
        tenant_id: paymentRecord.tenant_id || '',
        operation: 'payment_sync',
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

  /**
   * Check if an error is a rate limit error (HTTP 429)
   */
  private isRateLimitError(error: any): boolean {
    // Check for HTTP 429 status code
    if (error?.response?.status === 429) {
      return true
    }
    
    // Check for Xero-specific rate limit error messages
    if (error?.message && typeof error.message === 'string') {
      const message = error.message.toLowerCase()
      return message.includes('rate limit') || 
             message.includes('429') || 
             message.includes('too many requests') ||
             message.includes('quota exceeded')
    }
    
    // Check for Xero API error structure
    if (error?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message) {
      const validationMessage = error.response.body.Elements[0].ValidationErrors[0].Message.toLowerCase()
      return validationMessage.includes('rate limit') || 
             validationMessage.includes('429') || 
             validationMessage.includes('too many requests')
    }
    
    return false
  }
}

// Export singleton instance
export const xeroBatchSyncManager = new XeroBatchSyncManager()