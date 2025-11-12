/**
 * Xero Batch Sync Manager
 * 
 * Handles syncing staged records to Xero API with retry logic and error handling
 */

import { Invoice, LineItem, Payment, CurrencyCode, AccountingApi, CreditNote } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './client'
import { getOrCreateXeroContact, generateContactName } from './contacts'
import { createAdminClient } from '../supabase/admin'
import { Database } from '../../types/database'
import * as Sentry from '@sentry/nextjs'
import { getActiveTenant, validateXeroConnection } from './client'
import { centsToCents, centsToDollars } from '../../types/currency'

// Constants for date calculations
const DAYS_30_IN_MS = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds

/**
 * Calculate default due date (30 days from creation date)
 * @param createdAt - ISO timestamp string of invoice creation
 * @returns Due date in YYYY-MM-DD format
 */
function calculateDefaultDueDate(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + DAYS_30_IN_MS).toISOString().split('T')[0]
}

type XeroInvoiceRecord = Database['public']['Tables']['xero_invoices']['Row'] & {
  line_items: Database['public']['Tables']['xero_invoice_line_items']['Row'][]
}

type XeroPaymentRecord = Database['public']['Tables']['xero_payments']['Row']

export class XeroBatchSyncManager {
  private supabase: ReturnType<typeof createAdminClient>
  private isRunning: boolean = false
  private lastRunTime: Date | null = null
  private currentRunPromise: Promise<any> | null = null
  private readonly MIN_DELAY_BETWEEN_SYNCS = 2000 // 2 seconds minimum delay between syncs

  constructor() {
    this.supabase = createAdminClient()
  }

  /**
   * Get pending Xero records with proper database-level locking
   * 
   * Uses SELECT FOR UPDATE to lock records before processing, preventing
   * the same record from being processed by multiple concurrent operations.
   * This is the proper way to handle race conditions in database operations.
   */
  async getPendingXeroRecords(): Promise<{
    invoices: XeroInvoiceRecord[]
    payments: XeroPaymentRecord[]
  }> {
    try {
      console.log('🔒 Getting pending Xero records with proper database locking...')

      // Use a transaction with SELECT FOR UPDATE to lock records
      const { data: pendingInvoices, error: invoiceError } = await this.supabase
        .rpc('get_pending_xero_invoices_with_lock', {
          limit_count: 50
        })

      if (invoiceError) {
        console.error('❌ Error fetching pending invoices with lock:', invoiceError)
        throw invoiceError
      }

      // Use a transaction with SELECT FOR UPDATE to lock records
      const { data: pendingPayments, error: paymentError } = await this.supabase
        .rpc('get_pending_xero_payments_with_lock', {
          limit_count: 50
        })

      if (paymentError) {
        console.error('❌ Error fetching pending payments with lock:', paymentError)
        throw paymentError
      }

      console.log(`📊 Found ${pendingInvoices?.length || 0} pending invoices, ${pendingPayments?.length || 0} pending payments`)

      // Records are already locked and marked as processing by the database functions
      if (pendingInvoices && pendingInvoices.length > 0) {
        console.log(`🔒 Locked ${pendingInvoices.length} invoices for processing`)
      }

      if (pendingPayments && pendingPayments.length > 0) {
        console.log(`🔒 Locked ${pendingPayments.length} payments for processing`)
      }

      return {
        invoices: pendingInvoices || [],
        payments: pendingPayments || []
      }

    } catch (error) {
      console.error('❌ Error in getPendingXeroRecords:', error)
      throw error
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
   * Check if a sync operation is currently running
   */
  isSyncRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get the last run time of the sync operation
   */
  getLastRunTime(): Date | null {
    return this.lastRunTime
  }

  /**
   * Get the current sync status
   */
  getSyncStatus(): {
    isRunning: boolean
    lastRunTime: Date | null
    hasCurrentRun: boolean
    timeUntilNextSync: number
    minDelayBetweenSyncs: number
  } {
    return {
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      hasCurrentRun: this.currentRunPromise !== null,
      timeUntilNextSync: this.getTimeUntilNextSync(),
      minDelayBetweenSyncs: this.MIN_DELAY_BETWEEN_SYNCS
    }
  }

  /**
   * Get the time remaining before the next sync can start
   */
  getTimeUntilNextSync(): number {
    if (!this.lastRunTime) {
      return 0 // No previous run, can start immediately
    }
    
    const timeSinceLastRun = Date.now() - this.lastRunTime.getTime()
    const remainingDelay = this.MIN_DELAY_BETWEEN_SYNCS - timeSinceLastRun
    
    return Math.max(0, remainingDelay)
  }

  /**
   * Get the minimum delay configuration
   */
  getMinDelayBetweenSyncs(): number {
    return this.MIN_DELAY_BETWEEN_SYNCS
  }

  /**
   * Force stop a running sync operation
   * Note: This will not immediately stop the current operation, but will prevent new operations from starting
   */
  forceStop(): void {
    const callId = Math.random().toString(36).substring(2, 8)
    console.log(`🛑 [${callId}] Force stop requested for Xero batch sync`)
    
    if (this.isRunning) {
      console.log(`🛑 [${callId}] Force stopping Xero batch sync...`)
      this.isRunning = false
      this.currentRunPromise = null
      console.log(`🛑 [${callId}] Force stop completed`)
    } else {
      console.log(`ℹ️ [${callId}] Force stop requested but sync was not running`)
    }
  }

  /**
   * Sync all pending invoices and payments with intelligent batching
   * 
   * This method is protected against concurrent execution - if called while
   * another sync is running, it will return the result of the existing sync.
   * It also enforces a minimum delay between sync operations to prevent rate limits.
   */
  async syncAllPendingRecords(): Promise<{
    invoices: { synced: number; failed: number }
    payments: { synced: number; failed: number }
    connectionStatus: 'valid' | 'failed' | 'no_tenant'
  }> {
    const callTime = new Date()
    const callId = Math.random().toString(36).substring(2, 8) // Short unique ID for tracking
    
    console.log(`🔄 [${callId}] Xero batch sync requested at ${callTime.toISOString()}`)
    
    // Check if sync is already running
    if (this.isRunning) {
      console.log(`⚠️ [${callId}] Xero batch sync already running - returning existing promise`)
      if (this.currentRunPromise) {
        return this.currentRunPromise
      }
      // Fallback - shouldn't happen but just in case
      console.log(`⚠️ [${callId}] No existing promise found, returning empty result`)
      return {
        invoices: { synced: 0, failed: 0 },
        payments: { synced: 0, failed: 0 },
        connectionStatus: 'valid' as 'valid' | 'failed' | 'no_tenant'
      }
    }

    // Check minimum delay between syncs
    if (this.lastRunTime) {
      const timeSinceLastRun = Date.now() - this.lastRunTime.getTime()
      const remainingDelay = this.MIN_DELAY_BETWEEN_SYNCS - timeSinceLastRun
      
      if (remainingDelay > 0) {
        console.log(`⏳ [${callId}] Rate limit protection: waiting ${remainingDelay}ms before starting sync...`)
        console.log(`⏳ [${callId}] Last sync was ${timeSinceLastRun}ms ago, minimum delay is ${this.MIN_DELAY_BETWEEN_SYNCS}ms`)
        await new Promise(resolve => setTimeout(resolve, remainingDelay))
        console.log(`✅ [${callId}] Delay completed, proceeding with sync`)
      } else {
        console.log(`✅ [${callId}] No delay needed - last sync was ${timeSinceLastRun}ms ago (>= ${this.MIN_DELAY_BETWEEN_SYNCS}ms minimum)`)
      }
    } else {
      console.log(`✅ [${callId}] First sync run - no delay needed`)
    }

    // Set running state and create promise
    console.log(`🚀 [${callId}] Starting Xero batch sync...`)
    this.isRunning = true
    this.currentRunPromise = this.performSync()
    
    try {
      const result = await this.currentRunPromise
      console.log(`✅ [${callId}] Xero batch sync completed successfully`)
      return result
    } catch (error) {
      console.error(`❌ [${callId}] Xero batch sync failed:`, error)
      throw error
    } finally {
      // Always clean up state
      this.isRunning = false
      this.currentRunPromise = null
      this.lastRunTime = new Date()
      console.log(`🏁 [${callId}] Sync state cleaned up, lastRunTime updated to ${this.lastRunTime.toISOString()}`)
    }
  }

  /**
   * Internal method that performs the actual sync operation
   */
  private async performSync(): Promise<{
    invoices: { synced: number; failed: number }
    payments: { synced: number; failed: number }
    connectionStatus: 'valid' | 'failed' | 'no_tenant'
  }> {
    const startTime = Date.now()
    console.log('🔄 Starting intelligent batch sync of pending Xero records...')

    const results = {
      invoices: { synced: 0, failed: 0 },
      payments: { synced: 0, failed: 0 },
      connectionStatus: 'valid' as 'valid' | 'failed' | 'no_tenant'
    }

    try {
      // Phase 1: Check for pending records using centralized function
      console.log('📋 Phase 1: Checking for pending records...')
      const { invoices: pendingInvoices, payments: filteredPayments } = await this.getPendingXeroRecords()

      const pendingInvoiceCount = pendingInvoices?.length || 0
      const pendingPaymentCount = filteredPayments.length
      const totalPending = pendingInvoiceCount + pendingPaymentCount

      console.log(`📊 Found ${pendingInvoiceCount} pending invoices, ${pendingPaymentCount} eligible payments (${totalPending} total)`)

      // If no pending records, skip Xero connection entirely
      if (totalPending === 0) {
        console.log('✅ No pending records to sync - skipping Xero connection entirely (no API calls made)')
        return results
      }

      console.log(`🔄 Proceeding with sync: ${pendingInvoiceCount} invoices + ${pendingPaymentCount} payments = ${totalPending} total records`)

      // Phase 2: Connect to Xero (only if we have records to sync)
      console.log('🔌 Phase 2: Connecting to Xero...')
      
      // Check if Xero is connected before attempting any sync
      const activeTenant = await getActiveTenant()
      if (!activeTenant) {
        console.log('⚠️ No active Xero tenants found - skipping sync to preserve pending status')
        results.connectionStatus = 'no_tenant'
        return results
      }

      console.log(`🏢 Found ${activeTenant.tenant_name} active Xero tenant.`)

      // Validate connection to at least one tenant (only if we have records to sync)
      const isValid = await validateXeroConnection(activeTenant.tenant_id)
      if (!isValid) {
        console.log('⚠️ No valid Xero connections found - skipping sync to preserve pending status')
        results.connectionStatus = 'failed'
        return results
      }
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        console.log('⚠️ No Xero Authenticated Xero Client found - skipping sync to preserve pending status')
        results.connectionStatus = 'failed'
        return results
      }

      console.log(`✅ Valid connection to tenant: ${activeTenant.tenant_name}`)

      // Phase 3: Sync invoices and credit notes
      const invoiceStartTime = Date.now()
      if (pendingInvoices?.length) {
        console.log(`📄 Phase 3: Syncing ${pendingInvoices.length} invoices and credit notes...`)
        
        // Separate regular invoices from credit notes
        const regularInvoices = pendingInvoices.filter(inv => inv.invoice_type === 'ACCREC')
        const creditNotes = pendingInvoices.filter(inv => inv.invoice_type === 'ACCRECCREDIT')
        
        console.log(`📄 Found ${regularInvoices.length} regular invoices and ${creditNotes.length} credit notes`)
        
        const xeroInvoicesToSync: {xeroInvoice: Invoice, invoiceRecord: XeroInvoiceRecord}[] = []
        const xeroCreditNotesToSync: {xeroCreditNote: CreditNote, invoiceRecord: XeroInvoiceRecord}[] = []
        const xeroInvoicesFailed: XeroInvoiceRecord[] = []
        
        // Process regular invoices
        for (const invoiceRecord of regularInvoices) {
          const xeroInvoice = await this.getXeroInvoiceFromRecord(invoiceRecord)
          if (xeroInvoice) {
            console.log('✅ Xero invoice created:', xeroInvoice)
            xeroInvoicesToSync.push({xeroInvoice: xeroInvoice, invoiceRecord: invoiceRecord})
          }
          else{
            console.log('❌ Failed to create Xero invoice:', invoiceRecord)
            await this.markItemAsFailed(invoiceRecord.id, 'Failed to create Xero invoice')
            xeroInvoicesFailed.push(invoiceRecord)
          }
        }
        
        // Process credit notes
        for (const creditNoteRecord of creditNotes) {
          const xeroCreditNote = await this.getXeroCreditNoteFromRecord(creditNoteRecord)
          if (xeroCreditNote) {
            console.log('✅ Xero credit note created:', xeroCreditNote)
            xeroCreditNotesToSync.push({xeroCreditNote: xeroCreditNote, invoiceRecord: creditNoteRecord})
          }
          else{
            console.log('❌ Failed to create Xero credit note:', creditNoteRecord)
            await this.markItemAsFailed(creditNoteRecord.id, 'Failed to create Xero credit note')
            xeroInvoicesFailed.push(creditNoteRecord)
          }
        }

        console.log('🔄 Xero invoices to sync:', xeroInvoicesToSync.length)
        console.log('🔄 Xero credit notes to sync:', xeroCreditNotesToSync.length)
        console.log('❌ Xero invoices/credit notes failed:', xeroInvoicesFailed.length)

        // Sync regular invoices
        let invoiceResult = { success: true, synced: 0, failed: 0 }
        if (xeroInvoicesToSync.length > 0) {
          invoiceResult = await this.syncXeroInvoices(xeroInvoicesToSync, xeroApi, activeTenant.tenant_id)
        }

        // Sync credit notes
        let creditNoteResult = true
        if (xeroCreditNotesToSync.length > 0) {
          creditNoteResult = await this.syncXeroCreditNotes(xeroCreditNotesToSync, xeroApi, activeTenant.tenant_id)
        }

        // Update results based on both invoice and credit note sync results
        const totalSynced = invoiceResult.synced + (creditNoteResult ? xeroCreditNotesToSync.length : 0)
        const totalFailed = invoiceResult.failed + (creditNoteResult ? 0 : xeroCreditNotesToSync.length)

        results.invoices.synced = totalSynced
        results.invoices.failed = totalFailed

        console.log(`📊 Invoice sync completed: ${invoiceResult.synced} synced, ${invoiceResult.failed} failed`)
        if (xeroCreditNotesToSync.length > 0) {
          if (creditNoteResult) {
            console.log(`✅ Successfully synced ${xeroCreditNotesToSync.length} credit notes`)
          } else {
            console.log(`❌ Failed to sync ${xeroCreditNotesToSync.length} credit notes`)
          }
        }

        results.invoices.failed += xeroInvoicesFailed.length

        const invoiceDuration = Date.now() - invoiceStartTime
        console.log(`📊 Invoice sync completed in ${invoiceDuration}ms:`, {
          total: pendingInvoices.length,
          successful: results.invoices.synced,
          failed: results.invoices.failed,
          duration: invoiceDuration,
          averageTime: invoiceDuration / pendingInvoices.length
        })

        // Log failed invoices for admin review
        if (xeroInvoicesFailed.length > 0) {
          console.log('❌ Failed invoice syncs:', xeroInvoicesFailed.map(f => ({
            invoice: f.invoice_number,
            error: f.sync_status
          })))
        }
      }

      // Phase 4: Sync payments
      const paymentStartTime = Date.now()
      if (filteredPayments?.length) {
        console.log(`💰 Phase 4: Syncing ${filteredPayments.length} eligible payments...`)
        const xeroPaymentsToSync: Payment[] = []
        const xeroPaymentsFailed: XeroPaymentRecord[] = []
        for (const payment of filteredPayments) {
          const xeroPayment = await this.getXeroPaymentFromRecord(payment)
          if (xeroPayment) {
            console.log('✅ Xero payment created:', xeroPayment)
            xeroPaymentsToSync.push(xeroPayment)
          }
          else{
            console.log('❌ Failed to create Xero payment:', payment)
            await this.markPaymentAsFailed(payment.id, 'Failed to create Xero payment')
            xeroPaymentsFailed.push(payment)
          }
        }

        console.log('🔄 Xero payments to sync:', xeroPaymentsToSync.length)
        console.log('❌ Xero payments failed:', xeroPaymentsFailed.length)

        // Sync payments to Xero (if any)
        if (xeroPaymentsToSync.length > 0) {
          const paymentResult = await this.syncXeroPayments(xeroPaymentsToSync, filteredPayments, xeroApi, activeTenant.tenant_id)
          
          if (paymentResult) {
            results.payments.synced = xeroPaymentsToSync.length
            console.log(`✅ Successfully synced ${xeroPaymentsToSync.length} payments`)
          } else {
            results.payments.failed = xeroPaymentsToSync.length
            console.log(`❌ Failed to sync ${xeroPaymentsToSync.length} payments`)
          }
        }
        
        results.payments.failed += xeroPaymentsFailed.length

        const paymentDuration = Date.now() - paymentStartTime
        console.log(`📊 Payment sync completed in ${paymentDuration}ms:`, {
          total: filteredPayments.length,
          successful: results.payments.synced,
          failed: results.payments.failed,
          duration: paymentDuration,
          averageTime: paymentDuration / filteredPayments.length
        })

        // Log failed payments for admin review
        if (xeroPaymentsFailed.length > 0) {
          console.log('❌ Failed payment syncs:', xeroPaymentsFailed.map(f => ({
            payment: f.id,
            error: 'Failed to create Xero payment'
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
      // Mark as failed so the API route knows something went wrong
      results.connectionStatus = 'failed'
      return results
    }
  }


  /**
   * Get the Xero invoice object from the xero_invoices invoice record
   */
  async getXeroInvoiceFromRecord(invoiceRecord: XeroInvoiceRecord): Promise<Invoice | null> {
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
        return null
      }

      console.log('🏢 Using active tenant for sync:', activeTenant.tenant_name)

      // Get authenticated Xero client using active tenant
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        // Don't mark as failed - leave as pending for when Xero is reconnected
        console.log('⚠️ Unable to authenticate with Xero - leaving invoice as pending:', invoiceRecord.invoice_number)
        return null
      }

      // Get or create contact in Xero
      const metadata = invoiceRecord.staging_metadata as any
      console.log('👤 Getting/creating Xero contact for user:', metadata?.user_id)
      const contactResult = await getOrCreateXeroContact(metadata.user_id, activeTenant.tenant_id)
      console.log('👤 Contact result:', contactResult)
      
      // Apply rate limiting delay only if an API call was made
      if (contactResult.apiCallMade) {
        console.log('⏳ Contact API call was made, applying 100ms rate limiting delay...')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      if (!contactResult.success) {
        // Check if we have a valid xeroContactId despite the failure
        if (contactResult.xeroContactId) {
          console.log('⚠️ Contact sync failed but we have a valid contact ID, continuing:', contactResult.xeroContactId)
          // Continue with the sync using the existing contact ID
        } else {
          // Check if this is a rate limit error (429) - if so, don't fail the batch
          const isRateLimitError = contactResult.error?.includes('429') || 
                                   contactResult.error?.toLowerCase().includes('rate limit') ||
                                   contactResult.error?.toLowerCase().includes('too many requests')
          
          if (isRateLimitError) {
            console.log('⚠️ Contact sync hit rate limit (429), skipping this invoice but not failing batch:', contactResult.error)
            // Don't mark as failed, leave as pending so it can be retried later
            return null
          } else {
            console.log('❌ Contact sync failed with no valid contact ID:', contactResult.error)
            await this.markItemAsFailed(invoiceRecord.id, 'Failed to get/create Xero contact')
            return null
          }
        }
      }
      
      // Ensure we have a contact ID to proceed
      if (!contactResult.xeroContactId) {
        console.log('❌ No Xero contact ID available for invoice sync')
        await this.markItemAsFailed(invoiceRecord.id, 'No Xero contact ID available')
        return null
      }

      // Get user data for enhanced logging (contact name)
      const { data: userData } = await this.supabase
        .from('users')
        .select('first_name, last_name, member_id')
        .eq('id', metadata.user_id)
        .single()
      
      const contactName = userData 
        ? generateContactName(userData.first_name, userData.last_name, userData.member_id)
        : 'Unknown Contact'

      // Check if this is a zero-value invoice (always AUTHORISED)
      if (invoiceRecord.net_amount === 0) {
        console.log('✅ Zero-value invoice - marking as AUTHORISED')
        // Zero-value invoices are always AUTHORISED, no need to check payment status
      } else {
        // Non-zero invoices need payment verification
        if (!invoiceRecord.payment_id) {
          console.log('⚠️ No payment_id on non-zero invoice - skipping sync')
          return null
        }

        // Get payment status
        const { data: payment } = await this.supabase
          .from('payments')
          .select('status')
          .eq('id', invoiceRecord.payment_id)
          .single()

        if (!payment) {
          console.log('⚠️ No payment record found - skipping sync')
          return null
        }

        console.log('💰 Payment status:', payment.status, 'for invoice:', invoiceRecord.invoice_number)
        
        if (payment.status !== 'completed') {
          // Non-zero invoices with pending/failed payments should not be synced
          console.log('⏸️ Non-zero invoice with pending/failed payment - skipping sync')
          return null
        }

        console.log('✅ Completed payment - marking as AUTHORISED')
      }

      // Convert line items to Xero format
      const lineItems: LineItem[] = invoiceRecord.line_items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unit_amount / 100, // Convert cents to dollars
        accountCode: item.account_code || undefined,
        taxType: item.tax_type || 'NONE',
        lineAmount: item.line_amount / 100 // Convert cents to dollars
      }))

      console.log('📋 Line items prepared:', lineItems.length, 'items')

      // Calculate invoice due date
      // For payment plans: Due date = final payment date (to prevent "overdue" status before plan completes)
      // For regular invoices: Due date = 30 days from creation
      let dueDate: string

      // Check if this invoice is a payment plan by checking the is_payment_plan flag
      if (invoiceRecord.is_payment_plan) {
        console.log(`📅 Processing payment plan invoice: ${invoiceRecord.id}`)

        // Fetch the actual scheduled date of the final installment from xero_payments
        // This is the source of truth and works regardless of installment interval length
        const { data: finalPayment, error: paymentError } = await this.supabase
          .from('xero_payments')
          .select('planned_payment_date, installment_number')
          .eq('xero_invoice_id', invoiceRecord.id)
          .eq('payment_type', 'installment')
          .order('installment_number', { ascending: false })
          .limit(1)
          .single()

        if (paymentError) {
          // Database error querying xero_payments
          console.error(`❌ Error fetching final payment date for payment plan invoice ${invoiceRecord.id}:`, paymentError)
          console.warn('⚠️ Falling back to default 30-day due date due to database error')
          dueDate = calculateDefaultDueDate(invoiceRecord.created_at)
        } else if (!finalPayment) {
          // No payments found (data integrity issue)
          console.error(`❌ No installment payments found for payment plan invoice ${invoiceRecord.id}`)
          console.warn('⚠️ Falling back to default 30-day due date - manual review required')
          dueDate = calculateDefaultDueDate(invoiceRecord.created_at)
        } else {
          // Use the actual scheduled date of the final installment
          dueDate = finalPayment.planned_payment_date

          console.log(`📅 Payment plan invoice - due date set to final scheduled payment:`, {
            invoice_id: invoiceRecord.id,
            final_installment_number: finalPayment.installment_number,
            final_scheduled_date: dueDate
          })
        }
      } else {
        // Regular invoice: 30 days from creation
        dueDate = calculateDefaultDueDate(invoiceRecord.created_at)
      }

      // Create invoice object
      const invoice: Invoice = {
        type: Invoice.TypeEnum.ACCREC,
        contact: {
          contactID: contactResult.xeroContactId
        },
        lineItems,
        date: new Date(invoiceRecord.created_at).toISOString().split('T')[0], // YYYY-MM-DD format
        dueDate,
        // Let Xero generate its own invoice number - don't set invoiceNumber here
        reference: '', // Keep reference empty - payment intent ID is not relevant for invoice creation
        status: Invoice.StatusEnum.AUTHORISED,
        currencyCode: CurrencyCode.USD
      }

      return invoice

    } catch (error) {
      console.error('❌ Error getting Xero invoice from record:', error)
      return null
    }
  }

  /**
   * Create a Xero credit note from a database record
   */
  async getXeroCreditNoteFromRecord(creditNoteRecord: XeroInvoiceRecord): Promise<CreditNote | null> {
    let activeTenant: { tenant_id: string; tenant_name: string; expires_at: string } | null = null
    
    try {
      console.log('💳 Creating Xero credit note from record:', {
        id: creditNoteRecord.id,
        invoiceType: creditNoteRecord.invoice_type,
        netAmount: creditNoteRecord.net_amount
      })

      // Get the active tenant for Xero sync
      const { getActiveTenant } = await import('./client')
      activeTenant = await getActiveTenant()
      
      if (!activeTenant) {
        console.log('❌ No active Xero tenant available for credit note sync')
        // Don't mark as failed - leave as pending for when Xero is reconnected
        return null
      }

      // Parse staging metadata for refund details
      const metadata = creditNoteRecord.staging_metadata as any
      if (!metadata || !metadata.refund_id) {
        console.error('❌ No refund metadata found in credit note record')
        await this.markItemAsFailed(creditNoteRecord.id, 'No refund metadata available')
        return null
      }

      // Get the original invoice number for a better reference
      let originalInvoiceNumber = 'Unknown'
      if (creditNoteRecord.payment_id) {
        try {
          const { data: originalInvoice } = await this.supabase
            .from('xero_invoices')
            .select('invoice_number')
            .eq('payment_id', creditNoteRecord.payment_id)
            .eq('invoice_type', 'ACCREC')
            .single()
          
          if (originalInvoice?.invoice_number) {
            originalInvoiceNumber = originalInvoice.invoice_number
          }
        } catch (error) {
          console.log('⚠️ Could not find original invoice number, using fallback')
        }
      }

      // Get or create Xero contact
      console.log('👤 Getting/creating Xero contact for credit note user:', metadata.customer?.id || metadata.user_id)
      const contactResult = await getOrCreateXeroContact(metadata.customer?.id || metadata.user_id, activeTenant.tenant_id)
      if (!contactResult.success || !contactResult.xeroContactId) {
        console.error('❌ Failed to get/create Xero contact for credit note')
        await this.markItemAsFailed(creditNoteRecord.id, 'Failed to get/create Xero contact')
        return null
      }

      // Build line items from database (not metadata)
      const lineItems: LineItem[] = []
      if (creditNoteRecord.line_items && Array.isArray(creditNoteRecord.line_items)) {
        // Use staged line items from database
        console.log(`📋 Using ${creditNoteRecord.line_items.length} staged line items from database`)
        for (const item of creditNoteRecord.line_items) {
          // Line items are stored in cents in database, convert to dollars for Xero
          const unitAmountInCents = centsToCents(item.unit_amount || item.line_amount) // Use unit_amount if available, fallback to line_amount, maintain sign
          const lineAmountInCents = centsToCents(item.line_amount) // Maintain sign for proper accounting
          
          lineItems.push({
            description: item.description || `Refund: ${metadata.reason || 'Refund'}`,
            quantity: item.quantity || 1,
            unitAmount: centsToDollars(unitAmountInCents), // Convert cents to dollars, maintain sign
            accountCode: item.account_code || '400',
            taxType: item.tax_type || 'NONE',
            lineAmount: centsToDollars(lineAmountInCents) // Convert cents to dollars, maintain sign
          })
        }
      } else {
        // Fallback line item (should rarely be used now)
        console.log('⚠️ No line items found in database, using fallback')
        const fallbackAmountInCents = centsToCents(Math.abs(creditNoteRecord.net_amount))
        lineItems.push({
          description: metadata.reason || `Refund for ${originalInvoiceNumber}`,
          quantity: 1,
          unitAmount: centsToDollars(fallbackAmountInCents),
          accountCode: '400',
          taxType: 'NONE',
          lineAmount: centsToDollars(fallbackAmountInCents)
        })
      }

      // Create Xero credit note object
      const creditNote: CreditNote = {
        type: CreditNote.TypeEnum.ACCRECCREDIT,
        contact: {
          contactID: contactResult.xeroContactId
        },
        lineItems: lineItems,
        date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
        status: CreditNote.StatusEnum.AUTHORISED,
        currencyCode: CurrencyCode.USD,
        reference: metadata.reason || `Refund for ${originalInvoiceNumber}`
      }

      console.log('✅ Created Xero credit note object:', {
        type: creditNote.type,
        contactId: creditNote.contact?.contactID,
        lineItemsCount: creditNote.lineItems?.length || 0,
        total: lineItems.reduce((sum, item) => sum + (item.lineAmount || 0), 0),
        reference: creditNote.reference
      })

      return creditNote

    } catch (error) {
      console.error('❌ Error creating Xero credit note from record:', error)
      await this.markItemAsFailed(creditNoteRecord.id, `Error creating credit note: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    }
  }
    
  async syncXeroInvoices(xeroInvoicesToSync: {xeroInvoice: Invoice, invoiceRecord: XeroInvoiceRecord}[], xeroApi: { accountingApi: AccountingApi }, tenantId: string): Promise<{ success: boolean; synced: number; failed: number }> {
    let syncedCount = 0
    let failedCount = 0

    try{
    const response = await xeroApi.accountingApi.createInvoices(
      tenantId,
      { invoices: xeroInvoicesToSync.map(x => x.xeroInvoice) }
    )

    const invoicesSynced = response.body.invoices || []

    // Use array index to correlate request with response
    for (let i = 0; i < invoicesSynced.length; i++) {
      const xeroInvoice = invoicesSynced[i]
      const originalRecord = xeroInvoicesToSync[i]?.invoiceRecord
      
      if (!originalRecord) {
        console.error(`❌ No original record found for response index ${i}`)
        continue
      }

      // Check if invoice has validation errors
      if (xeroInvoice.hasErrors || (xeroInvoice.validationErrors && xeroInvoice.validationErrors.length > 0)) {
        const errorMessages = xeroInvoice.validationErrors?.map(e => e.message).join('; ') || 'Unknown validation error'
        console.error(`❌ Invoice validation failed for record ${originalRecord.id}:`, errorMessages)

        // Mark invoice as failed
        await this.markItemAsFailed(
          originalRecord.id,
          `Xero validation error: ${errorMessages}`
        )

        // Log failure
        await logXeroSync({
          tenant_id: tenantId,
          operation: 'invoice_sync',
          record_type: 'invoice',
          record_id: originalRecord.id,
          success: false,
          details: `Invoice sync failed: ${errorMessages}`,
          response_data: {
            validationErrors: xeroInvoice.validationErrors,
            invoice: xeroInvoice
          },
          request_data: {
            invoice: xeroInvoicesToSync[i].xeroInvoice
          }
        })

        failedCount++
        continue
      }

      // Mark invoice as synced in database
      await this.markItemAsSynced(
        originalRecord.id,
        xeroInvoice.invoiceID!,
        xeroInvoice.invoiceNumber!,
        tenantId
      )

      // Log success
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'invoice_sync',
        record_type: 'invoice',
        record_id: originalRecord.id,
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
            type: xeroInvoicesToSync[i].xeroInvoice.type,
            contact: xeroInvoicesToSync[i].xeroInvoice.contact,
            lineItems: xeroInvoicesToSync[i].xeroInvoice.lineItems,
            date: xeroInvoicesToSync[i].xeroInvoice.date,
            dueDate: xeroInvoicesToSync[i].xeroInvoice.dueDate,
            reference: xeroInvoicesToSync[i].xeroInvoice.reference,
            status: xeroInvoicesToSync[i].xeroInvoice.status,
            currencyCode: xeroInvoicesToSync[i].xeroInvoice.currencyCode
          }
        }
      })

      syncedCount++
    }

    console.log(`✅ Xero invoice sync completed: ${syncedCount} synced, ${failedCount} failed`)
    return { success: true, synced: syncedCount, failed: failedCount }
    } catch (error: any) {
      console.error('❌ Error syncing Xero invoices:', error)

      // The Xero SDK may serialize the error as a JSON string
      let parsedError = error
      if (typeof error === 'string') {
        try {
          parsedError = JSON.parse(error)
        } catch (e) {
          // If parsing fails, use original error
          parsedError = error
        }
      }

      // The Xero SDK wraps errors - check both error.response.body and error.body
      const errorBody = parsedError?.response?.body || parsedError?.body || parsedError

      // Check if we have Elements array (batch error response)
      if (errorBody?.Elements && Array.isArray(errorBody.Elements)) {
        console.log('📋 Processing individual invoice errors from Xero batch response')
        console.log(`📋 Found ${errorBody.Elements.length} elements in error response`)

        // Each Element is an invoice with ValidationErrors directly on it
        for (let i = 0; i < errorBody.Elements.length; i++) {
          const element = errorBody.Elements[i]
          const originalRecord = xeroInvoicesToSync[i]?.invoiceRecord

          if (!originalRecord) {
            console.error(`❌ No original record found for element index ${i}`)
            continue
          }

          // Extract validation errors from the element
          const validationErrors = element.ValidationErrors || []
          if (validationErrors.length > 0) {
            const errorMessages = validationErrors.map((e: any) => e.Message).join('; ')
            console.error(`❌ Invoice validation failed for record ${originalRecord.id}:`, errorMessages)

            // Mark invoice as failed with specific error
            await this.markItemAsFailed(
              originalRecord.id,
              `Xero validation error: ${errorMessages}`
            )

            // Log failure
            await logXeroSync({
              tenant_id: tenantId,
              operation: 'invoice_sync',
              record_type: 'invoice',
              record_id: originalRecord.id,
              success: false,
              details: `Invoice sync failed: ${errorMessages}`,
              response_data: {
                validationErrors: validationErrors,
                invoice: element
              },
              request_data: {
                invoice: xeroInvoicesToSync[i]?.xeroInvoice
              }
            })
            failedCount++
          } else {
            console.log(`✅ Element ${i} has no validation errors, marking as synced`)
            // This invoice succeeded - mark it as synced
            const xeroInvoiceId = element.InvoiceID
            const xeroInvoiceNumber = element.InvoiceNumber
            if (xeroInvoiceId && xeroInvoiceId !== '00000000-0000-0000-0000-000000000000' && xeroInvoiceNumber) {
              await this.markItemAsSynced(originalRecord.id, xeroInvoiceId, xeroInvoiceNumber, tenantId)
              await logXeroSync({
                tenant_id: tenantId,
                operation: 'invoice_sync',
                record_type: 'invoice',
                record_id: originalRecord.id,
                success: true,
                details: `Invoice ${xeroInvoiceNumber} synced successfully`,
                response_data: { invoice: element }
              })
              syncedCount++
            }
          }
        }
      } else {
        // Generic error - mark all invoices in this batch as failed
        const errorMessage = error?.message || error?.response?.statusText || 'Unknown error'
        console.error('❌ Batch sync error (no Elements array):', errorMessage)

        for (const item of xeroInvoicesToSync) {
          await this.markItemAsFailed(
            item.invoiceRecord.id,
            `Batch sync error: ${errorMessage}`
          )
          failedCount++
        }
      }

      console.log(`❌ Xero invoice sync completed with errors: ${syncedCount} synced, ${failedCount} failed`)
      return { success: false, synced: syncedCount, failed: failedCount }
    }
  }

  /**
   * Sync credit notes to Xero using batch API
   */
  async syncXeroCreditNotes(xeroCreditNotesToSync: {xeroCreditNote: CreditNote, invoiceRecord: XeroInvoiceRecord}[], xeroApi: { accountingApi: AccountingApi }, tenantId: string): Promise<boolean> {
    try{
      const response = await xeroApi.accountingApi.createCreditNotes(
        tenantId,
        { creditNotes: xeroCreditNotesToSync.map(x => x.xeroCreditNote) }
      )

      const creditNotesSynced = response.body.creditNotes || []
      
      // Use array index to correlate request with response
      for (let i = 0; i < creditNotesSynced.length; i++) {
        const xeroCreditNote = creditNotesSynced[i]
        const originalRecord = xeroCreditNotesToSync[i]?.invoiceRecord
        
        if (!originalRecord) {
          console.error(`❌ No original record found for response index ${i}`)
          continue
        }

        // Mark credit note as synced in database
        await this.markItemAsSynced(
          originalRecord.id,
          xeroCreditNote.creditNoteID!,
          xeroCreditNote.creditNoteNumber!,
          tenantId
        )

        // Log success
        await logXeroSync({
          tenant_id: tenantId,
          operation: 'credit_note_sync',
          record_type: 'credit_note',
          record_id: originalRecord.id,
          xero_id: xeroCreditNote.creditNoteID,
          success: true,
          details: `Credit note ${xeroCreditNote.creditNoteNumber} created successfully`,
          response_data: {
            creditNote: {
              creditNoteID: xeroCreditNote.creditNoteID,
              creditNoteNumber: xeroCreditNote.creditNoteNumber,
              status: xeroCreditNote.status,
              type: xeroCreditNote.type,
              total: xeroCreditNote.total,
              subTotal: xeroCreditNote.subTotal,
              date: xeroCreditNote.date,
              currencyCode: xeroCreditNote.currencyCode
            }
          },
          request_data: {
            creditNote: {
              type: xeroCreditNotesToSync[i].xeroCreditNote.type,
              contact: xeroCreditNotesToSync[i].xeroCreditNote.contact,
              lineItems: xeroCreditNotesToSync[i].xeroCreditNote.lineItems,
              date: xeroCreditNotesToSync[i].xeroCreditNote.date,
              reference: xeroCreditNotesToSync[i].xeroCreditNote.reference,
              status: xeroCreditNotesToSync[i].xeroCreditNote.status,
              currencyCode: xeroCreditNotesToSync[i].xeroCreditNote.currencyCode
            }
          }
        })
      }

      console.log('✅ Xero credit note(s) created:', response.body.creditNotes?.length || 0)
      return true
    } catch (error) {
      console.error('❌ Error syncing Xero credit notes:', error)
      return false
    }
  }

  /**
   * Sync payments to Xero using batch API
   */
  async syncXeroPayments(xeroPayments: Payment[], paymentRecords: XeroPaymentRecord[], xeroApi: { accountingApi: AccountingApi }, tenantId: string): Promise<boolean> {
    try {
      const response = await xeroApi.accountingApi.createPayments(
        tenantId,
        { payments: xeroPayments }
      )

      const paymentsSynced = response.body.payments || []
      
      // Use array index to correlate request with response
      for (let i = 0; i < paymentsSynced.length; i++) {
        const xeroPayment = paymentsSynced[i]
        const originalRecord = paymentRecords[i]
        
        if (!originalRecord) {
          console.error(`❌ No original payment record found for response index ${i}`)
          continue
        }

        // Mark payment as synced in database
        await this.markPaymentAsSynced(
          originalRecord.id,
          xeroPayment.paymentID!,
          tenantId
        )

        // Log success
        await logXeroSync({
          tenant_id: tenantId,
          operation: 'payment_sync',
          record_type: 'payment',
          record_id: originalRecord.id,
          xero_id: xeroPayment.paymentID,
          success: true,
          details: `Payment ${xeroPayment.paymentID} created successfully`,
          response_data: {
            payment: {
              paymentID: xeroPayment.paymentID,
              amount: xeroPayment.amount,
              date: xeroPayment.date,
              reference: xeroPayment.reference,
              invoiceID: xeroPayment.invoice?.invoiceID
            }
          },
          request_data: {
            payment: {
              amount: xeroPayments[i].amount,
              date: xeroPayments[i].date,
              reference: xeroPayments[i].reference,
              invoiceID: xeroPayments[i].invoice?.invoiceID,
              accountCode: xeroPayments[i].account?.code
            }
          }
        })
      }

      console.log('✅ Xero payment(s) created:', response.body.payments?.length || 0)
      return true
    } catch (error) {
      console.error('❌ Error syncing Xero payments:', error)
      return false
    }
  }
  
  /**
   * Generate a Xero payment object from a payment record
   */
  async getXeroPaymentFromRecord(paymentRecord: XeroPaymentRecord): Promise<Payment | null> {
    let activeTenant: { tenant_id: string; tenant_name: string; expires_at: string } | null = null
    
    try {
      console.log('💰 Syncing payment to Xero:', {
        id: paymentRecord.id,
        xeroInvoiceId: paymentRecord.xero_invoice_id,
        amountPaid: paymentRecord.amount_paid,
        reference: paymentRecord.reference,
        bankAccountCode: paymentRecord.bank_account_code
      })

      // Get the associated invoice/credit note record
      const { data: invoiceRecord } = await this.supabase
        .from('xero_invoices')
        .select('xero_invoice_id, invoice_number, invoice_type')
        .eq('id', paymentRecord.xero_invoice_id)
        .single()

      if (!invoiceRecord || !invoiceRecord.xero_invoice_id) {
        console.log('❌ Associated invoice not synced to Xero yet - skipping payment')
        await this.markPaymentAsFailed(paymentRecord.id, 'Associated invoice not synced to Xero yet')
        return null
      }

      const isInvoice = invoiceRecord.invoice_type === 'ACCREC'
      const isCreditNote = invoiceRecord.invoice_type === 'ACCRECCREDIT'
      console.log(`📄 Found associated ${isInvoice ? 'invoice' : 'credit note'}:`, invoiceRecord.xero_invoice_id)

      // Get the active tenant for Xero sync
      const { getActiveTenant } = await import('./client')
      activeTenant = await getActiveTenant()
      
      if (!activeTenant) {
        console.log('❌ No active Xero tenant available for sync')
        // Don't mark as failed - leave as pending for when Xero is reconnected
        return null
      }

      console.log('🏢 Using active tenant for sync:', activeTenant.tenant_name)

      // Get authenticated Xero client using active tenant
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        // Don't mark as failed - leave as pending for when Xero is reconnected
        console.log('⚠️ Unable to authenticate with Xero - leaving payment as pending:', paymentRecord.id)
        return null
      }

      // No need to check invoice status - if payment is in pending status, it should be created
      // If Xero returns an error for duplicate/invalid payment, we'll handle it gracefully

      // Get the Stripe bank account code from system_accounting_codes
      const { data: stripeAccountCode } = await this.supabase
        .from('system_accounting_codes')
        .select('accounting_code')
        .eq('code_type', 'stripe_bank_account')
        .single()

      const bankAccountCode = paymentRecord.bank_account_code || stripeAccountCode?.accounting_code || '090'

      // Create payment object - use invoice or creditNote depending on type
      const payment: Payment = {
        account: {
          code: bankAccountCode
        },
        amount: Math.abs(paymentRecord.amount_paid) / 100, // Convert cents to dollars, ensure positive for Xero
        date: new Date().toISOString().split('T')[0],
        reference: paymentRecord.reference || (paymentRecord.staging_metadata as any)?.stripe_charge_id || invoiceRecord.invoice_number || ''
      }

      // Add either invoice or creditNote field based on the record type
      if (isInvoice) {
        payment.invoice = {
          invoiceID: invoiceRecord.xero_invoice_id
        }
      } else if (isCreditNote) {
        payment.creditNote = {
          creditNoteID: invoiceRecord.xero_invoice_id
        }
      }

      return payment

    } catch (error) {
      console.error('❌ Error getting Xero payment from record:', error)
      return null
    }
  }

  /**
   * Mark invoice as successfully synced
   */
  private async markItemAsSynced(
    stagingId: string, 
    xeroId: string, 
    number: string,
    tenantId?: string
  ) {
    console.log('💾 Marking item as synced:', {
      stagingId,
      xeroId,
      number,
      tenantId
    })
    
    const updateData: any = {
      xero_invoice_id: xeroId,
      invoice_number: number,
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
  private async markItemAsFailed(stagingId: string, error: string) {
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
  private async markPaymentAsSynced(stagingId: string, xeroPaymentId: string, tenantId?: string) {
    console.log('💾 Marking payment as synced:', {
      stagingId,
      xeroPaymentId,
      tenantId
    })
    
    const updateData: any = {
      xero_payment_id: xeroPaymentId,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      sync_error: null
    }

    // Set tenant_id if provided (for records that were staged without tenant_id)
    if (tenantId) {
      updateData.tenant_id = tenantId
    }
    
    const { data, error } = await this.supabase
      .from('xero_payments')
      .update(updateData)
      .eq('id', stagingId)
      .select('id, sync_status')

    if (error) {
      console.error('❌ Error marking payment as synced:', error)
    } else {
      console.log('✅ Payment marked as synced successfully:', data)
    }
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