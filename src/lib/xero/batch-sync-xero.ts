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
import { asHttpClientError, getXeroErrorStatus, getXeroValidationMessage, parseXeroBatchError } from './xero-errors'
import { logger } from '@/lib/logging/logger'

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

type SyncResult = {
  invoices: { synced: number; failed: number }
  credit_notes: { synced: number; failed: number }
  payments: { synced: number; failed: number }
  connectionStatus: 'valid' | 'failed' | 'no_tenant'
}

/** The subset of `staging_metadata`'s fields this module reads. `staging_metadata` is
 * genuinely-polymorphic JSON written by several different call sites (staging.ts, Stripe
 * webhook, refund routes) — this is not the full shape, just what's used here. */
interface XeroStagingMetadata {
  user_id?: string
  customer?: { id?: string }
  refund_id?: string
  reason?: string
  stripe_charge_id?: string
}

export class XeroBatchSyncManager {
  private _supabase: ReturnType<typeof createAdminClient> | null = null
  private isRunning: boolean = false
  private lastRunTime: Date | null = null
  private currentRunPromise: Promise<SyncResult> | null = null
  private readonly MIN_DELAY_BETWEEN_SYNCS = 2000 // 2 seconds minimum delay between syncs

  private get supabase(): ReturnType<typeof createAdminClient> {
    if (!this._supabase) {
      this._supabase = createAdminClient()
    }
    return this._supabase
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
    // Use a transaction with SELECT FOR UPDATE to lock records
    const { data: pendingInvoices, error: invoiceError } = await this.supabase
      .rpc('get_pending_xero_invoices_with_lock', {
        limit_count: 50
      })

    if (invoiceError) {
      logger.logXeroSync('get-pending-invoices-failed', 'Error fetching pending invoices with lock', { error: invoiceError }, 'error')
      throw invoiceError
    }

    // Use a transaction with SELECT FOR UPDATE to lock records
    const { data: pendingPayments, error: paymentError } = await this.supabase
      .rpc('get_pending_xero_payments_with_lock', {
        limit_count: 50
      })

    if (paymentError) {
      logger.logXeroSync('get-pending-payments-failed', 'Error fetching pending payments with lock', { error: paymentError }, 'error')
      throw paymentError
    }

    // Records are already locked and marked as processing by the database functions
    return {
      invoices: pendingInvoices || [],
      payments: pendingPayments || []
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
    const wasRunning = this.isRunning

    if (this.isRunning) {
      this.isRunning = false
      this.currentRunPromise = null
    }

    logger.logXeroSync(
      'force-stop',
      wasRunning ? 'Force stop: Xero batch sync was running, stopped' : 'Force stop requested but sync was not running',
      { callId, wasRunning }
    )
  }

  /**
   * Sync all pending invoices, credit notes, and payments with intelligent batching
   *
   * This method is protected against concurrent execution - if called while
   * another sync is running, it will return the result of the existing sync.
   * It also enforces a minimum delay between sync operations to prevent rate limits.
   */
  async syncAllPendingRecords(): Promise<{
    invoices: { synced: number; failed: number }
    credit_notes: { synced: number; failed: number }
    payments: { synced: number; failed: number }
    connectionStatus: 'valid' | 'failed' | 'no_tenant'
  }> {
    const callTime = new Date()
    const callId = Math.random().toString(36).substring(2, 8) // Short unique ID for tracking

    logger.logXeroSync('batch-sync-requested', 'Xero batch sync requested', { callId, callTime: callTime.toISOString() }, 'debug')

    // Check if sync is already running
    if (this.isRunning) {
      if (this.currentRunPromise) {
        logger.logXeroSync('batch-sync-dedup', 'Xero batch sync already running - returning existing promise', { callId }, 'debug')
        return this.currentRunPromise
      }
      // Fallback - shouldn't happen but just in case
      logger.logXeroSync('batch-sync-inconsistent-state', 'Sync marked as running but no existing promise found - returning empty result', { callId }, 'warn')
      return {
        invoices: { synced: 0, failed: 0 },
        credit_notes: { synced: 0, failed: 0 },
        payments: { synced: 0, failed: 0 },
        connectionStatus: 'valid' as 'valid' | 'failed' | 'no_tenant'
      }
    }

    // Check minimum delay between syncs
    if (this.lastRunTime) {
      const timeSinceLastRun = Date.now() - this.lastRunTime.getTime()
      const remainingDelay = this.MIN_DELAY_BETWEEN_SYNCS - timeSinceLastRun

      if (remainingDelay > 0) {
        logger.logXeroSync(
          'batch-sync-rate-limit-delay',
          `Rate limit protection: waiting ${remainingDelay}ms before starting sync`,
          { callId, remainingDelay, timeSinceLastRun, minDelayBetweenSyncs: this.MIN_DELAY_BETWEEN_SYNCS },
          'debug'
        )
        await new Promise(resolve => setTimeout(resolve, remainingDelay))
      }
    }

    // Set running state and create promise
    this.isRunning = true
    this.currentRunPromise = this.performSync()

    try {
      const result = await this.currentRunPromise
      return result
    } catch (error) {
      logger.logXeroSync('batch-sync-failed', 'Xero batch sync failed', { callId, error: error instanceof Error ? error.message : String(error) }, 'error')
      throw error
    } finally {
      // Always clean up state
      this.isRunning = false
      this.currentRunPromise = null
      this.lastRunTime = new Date()
    }
  }

  /**
   * Internal method that performs the actual sync operation
   */
  private async performSync(): Promise<SyncResult> {
    const startTime = Date.now()

    const results = {
      invoices: { synced: 0, failed: 0 },
      credit_notes: { synced: 0, failed: 0 },
      payments: { synced: 0, failed: 0 },
      connectionStatus: 'valid' as 'valid' | 'failed' | 'no_tenant'
    }

    try {
      // Phase 1: Check for pending records using centralized function
      const { invoices: pendingInvoices, payments: filteredPayments } = await this.getPendingXeroRecords()

      const pendingInvoiceCount = pendingInvoices?.length || 0
      const pendingPaymentCount = filteredPayments.length
      const totalPending = pendingInvoiceCount + pendingPaymentCount

      logger.logXeroSync(
        'pending-records-found',
        `Found ${pendingInvoiceCount} pending invoices, ${pendingPaymentCount} eligible payments (${totalPending} total)`,
        { pendingInvoiceCount, pendingPaymentCount, totalPending },
        'debug'
      )

      // If no pending records, skip Xero connection entirely
      if (totalPending === 0) {
        logger.logXeroSync('no-pending-records', 'No pending records to sync - skipping Xero connection entirely (no API calls made)', undefined, 'debug')
        return results
      }

      // Phase 2: Connect to Xero (only if we have records to sync)

      // Check if Xero is connected before attempting any sync
      const activeTenant = await getActiveTenant()
      if (!activeTenant) {
        logger.logXeroSync('no-active-tenant', 'No active Xero tenants found - skipping sync to preserve pending status', undefined, 'warn')
        results.connectionStatus = 'no_tenant'
        return results
      }

      // Validate connection to at least one tenant (only if we have records to sync)
      const isValid = await validateXeroConnection(activeTenant.tenant_id)
      if (!isValid) {
        logger.logXeroSync('invalid-connection', 'No valid Xero connections found - skipping sync to preserve pending status', { tenantId: activeTenant.tenant_id }, 'warn')
        results.connectionStatus = 'failed'
        return results
      }
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        logger.logXeroSync('no-authenticated-client', 'No authenticated Xero client found - skipping sync to preserve pending status', { tenantId: activeTenant.tenant_id }, 'warn')
        results.connectionStatus = 'failed'
        return results
      }

      // Phase 3: Sync invoices and credit notes
      const invoiceStartTime = Date.now()
      if (pendingInvoices?.length) {
        // Separate regular invoices from credit notes
        const regularInvoices = pendingInvoices.filter(inv => inv.invoice_type === 'ACCREC')
        const creditNotes = pendingInvoices.filter(inv => inv.invoice_type === 'ACCRECCREDIT')

        const xeroInvoicesToSync: {xeroInvoice: Invoice, invoiceRecord: XeroInvoiceRecord}[] = []
        const xeroCreditNotesToSync: {xeroCreditNote: CreditNote, invoiceRecord: XeroInvoiceRecord}[] = []
        const xeroInvoicesFailed: XeroInvoiceRecord[] = []

        // Process regular invoices
        for (const invoiceRecord of regularInvoices) {
          const xeroInvoice = await this.getXeroInvoiceFromRecord(invoiceRecord)
          if (xeroInvoice) {
            xeroInvoicesToSync.push({xeroInvoice: xeroInvoice, invoiceRecord: invoiceRecord})
          }
          else{
            logger.logXeroSync('invoice-object-build-failed', 'Failed to build Xero invoice object from record', { invoiceRecordId: invoiceRecord.id, invoiceNumber: invoiceRecord.invoice_number }, 'warn')
            await this.markItemAsFailed(invoiceRecord.id, 'Failed to create Xero invoice')
            xeroInvoicesFailed.push(invoiceRecord)
          }
        }

        // Process credit notes
        for (const creditNoteRecord of creditNotes) {
          const xeroCreditNote = await this.getXeroCreditNoteFromRecord(creditNoteRecord)
          if (xeroCreditNote) {
            xeroCreditNotesToSync.push({xeroCreditNote: xeroCreditNote, invoiceRecord: creditNoteRecord})
          }
          else{
            logger.logXeroSync('credit-note-object-build-failed', 'Failed to build Xero credit note object from record', { creditNoteRecordId: creditNoteRecord.id }, 'warn')
            await this.markItemAsFailed(creditNoteRecord.id, 'Failed to create Xero credit note')
            xeroInvoicesFailed.push(creditNoteRecord)
          }
        }

        // Sync regular invoices
        let invoiceResult = { success: true, synced: 0, failed: 0 }
        if (xeroInvoicesToSync.length > 0) {
          invoiceResult = await this.syncXeroInvoices(xeroInvoicesToSync, xeroApi, activeTenant.tenant_id)
        }

        // Sync credit notes
        let creditNoteResult = { success: true, synced: 0, failed: 0 }
        if (xeroCreditNotesToSync.length > 0) {
          creditNoteResult = await this.syncXeroCreditNotes(xeroCreditNotesToSync, xeroApi, activeTenant.tenant_id)
        }

        // Update results separately for invoices and credit notes
        results.invoices.synced = invoiceResult.synced
        results.invoices.failed = invoiceResult.failed + xeroInvoicesFailed.filter(item => item.invoice_type === 'ACCREC').length

        results.credit_notes.synced = creditNoteResult.synced
        results.credit_notes.failed = creditNoteResult.failed + xeroInvoicesFailed.filter(item => item.invoice_type === 'ACCRECCREDIT').length

        const invoiceDuration = Date.now() - invoiceStartTime
        logger.logXeroSync('invoice-phase-completed', `Invoice/credit note sync phase completed in ${invoiceDuration}ms`, {
          total: pendingInvoices.length,
          regularInvoices: regularInvoices.length,
          creditNotes: creditNotes.length,
          invoicesSynced: results.invoices.synced,
          invoicesFailed: results.invoices.failed,
          creditNotesSynced: results.credit_notes.synced,
          creditNotesFailed: results.credit_notes.failed,
          duration: invoiceDuration,
          averageTime: invoiceDuration / pendingInvoices.length
        })

        // Log failed invoices for admin review
        if (xeroInvoicesFailed.length > 0) {
          logger.logXeroSync(
            'failed-invoice-syncs',
            `${xeroInvoicesFailed.length} invoice(s)/credit note(s) failed to sync`,
            { failed: xeroInvoicesFailed.map(f => ({ invoice: f.invoice_number, error: f.sync_status })) },
            'warn'
          )
        }
      }

      // Phase 4: Sync payments
      const paymentStartTime = Date.now()
      if (filteredPayments?.length) {
        const xeroPaymentsToSync: Payment[] = []
        const xeroPaymentsFailed: XeroPaymentRecord[] = []
        for (const payment of filteredPayments) {
          const xeroPayment = await this.getXeroPaymentFromRecord(payment)
          if (xeroPayment) {
            xeroPaymentsToSync.push(xeroPayment)
          }
          else{
            logger.logXeroSync('payment-object-build-failed', 'Failed to build Xero payment object from record', { paymentRecordId: payment.id }, 'warn')
            await this.markPaymentAsFailed(payment.id, 'Failed to create Xero payment')
            xeroPaymentsFailed.push(payment)
          }
        }

        // Sync payments to Xero (if any)
        if (xeroPaymentsToSync.length > 0) {
          const paymentResult = await this.syncXeroPayments(xeroPaymentsToSync, filteredPayments, xeroApi, activeTenant.tenant_id)

          if (paymentResult) {
            results.payments.synced = xeroPaymentsToSync.length
          } else {
            results.payments.failed = xeroPaymentsToSync.length
            logger.logXeroSync('payment-batch-sync-failed', `Failed to sync ${xeroPaymentsToSync.length} payment(s)`, { count: xeroPaymentsToSync.length }, 'warn')
          }
        }

        results.payments.failed += xeroPaymentsFailed.length

        const paymentDuration = Date.now() - paymentStartTime
        logger.logXeroSync('payment-phase-completed', `Payment sync phase completed in ${paymentDuration}ms`, {
          total: filteredPayments.length,
          successful: results.payments.synced,
          failed: results.payments.failed,
          duration: paymentDuration,
          averageTime: paymentDuration / filteredPayments.length
        })

        // Log failed payments for admin review
        if (xeroPaymentsFailed.length > 0) {
          logger.logXeroSync(
            'failed-payment-syncs',
            `${xeroPaymentsFailed.length} payment(s) failed to sync`,
            { failed: xeroPaymentsFailed.map(f => ({ payment: f.id, error: 'Failed to create Xero payment' })) },
            'warn'
          )
        }
      }

      const totalDuration = Date.now() - startTime
      logger.logXeroSync('batch-sync-completed', 'Intelligent batch sync completed', {
        ...results,
        totalDuration,
        totalRecords: (pendingInvoices?.length || 0) + (filteredPayments?.length || 0),
        totalSuccessful: results.invoices.synced + results.credit_notes.synced + results.payments.synced,
        totalFailed: results.invoices.failed + results.credit_notes.failed + results.payments.failed
      })

      return results

    } catch (error) {
      const totalDuration = Date.now() - startTime
      logger.logXeroSync('batch-sync-error', `Error in batch sync (failed after ${totalDuration}ms)`, { totalDuration, error: error instanceof Error ? error.message : String(error) }, 'error')
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
      // Get the active tenant for Xero sync
      const { getActiveTenant } = await import('./client')
      activeTenant = await getActiveTenant()

      if (!activeTenant) {
        logger.logXeroSync('no-active-tenant', 'No active Xero tenant available for invoice sync', { invoiceRecordId: invoiceRecord.id, invoiceNumber: invoiceRecord.invoice_number }, 'warn')
        // Don't mark as failed - leave as pending for when Xero is reconnected
        return null
      }

      // Get authenticated Xero client using active tenant
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        // Don't mark as failed - leave as pending for when Xero is reconnected
        logger.logXeroSync('auth-failed', 'Unable to authenticate with Xero - leaving invoice as pending', { invoiceNumber: invoiceRecord.invoice_number, tenantId: activeTenant.tenant_id }, 'warn')
        return null
      }

      // Get or create contact in Xero
      const metadata = invoiceRecord.staging_metadata as XeroStagingMetadata
      const contactResult = await getOrCreateXeroContact(metadata.user_id!, activeTenant.tenant_id)

      // Apply rate limiting delay only if an API call was made
      if (contactResult.apiCallMade) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (!contactResult.success) {
        // Check if we have a valid xeroContactId despite the failure
        if (contactResult.xeroContactId) {
          // Continue with the sync using the existing contact ID
          logger.logXeroSync('contact-sync-partial-failure', 'Contact sync failed but a valid contact ID was returned, continuing', { xeroContactId: contactResult.xeroContactId, invoiceRecordId: invoiceRecord.id }, 'warn')
        } else {
          // Check if this is a rate limit error (429) - if so, don't fail the batch
          const isRateLimitError = contactResult.error?.includes('429') ||
                                   contactResult.error?.toLowerCase().includes('rate limit') ||
                                   contactResult.error?.toLowerCase().includes('too many requests')

          if (isRateLimitError) {
            logger.logXeroSync('contact-sync-rate-limited', 'Contact sync hit rate limit (429), skipping this invoice but not failing batch', { error: contactResult.error, invoiceRecordId: invoiceRecord.id }, 'warn')
            // Don't mark as failed, leave as pending so it can be retried later
            return null
          } else {
            logger.logXeroSync('contact-sync-failed', 'Contact sync failed with no valid contact ID', { error: contactResult.error, invoiceRecordId: invoiceRecord.id }, 'error')
            await this.markItemAsFailed(invoiceRecord.id, 'Failed to get/create Xero contact')
            return null
          }
        }
      }

      // Ensure we have a contact ID to proceed
      if (!contactResult.xeroContactId) {
        logger.logXeroSync('no-contact-id', 'No Xero contact ID available for invoice sync', { invoiceRecordId: invoiceRecord.id }, 'error')
        await this.markItemAsFailed(invoiceRecord.id, 'No Xero contact ID available')
        return null
      }

      // Get user data for enhanced logging (contact name)
      const { data: userData } = await this.supabase
        .from('users')
        .select('first_name, last_name, member_id')
        .eq('id', metadata.user_id)
        .single()

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- computed for enhanced logging (per comment above) but never consumed; flagged, not removed, since this may indicate a missing log/usage rather than genuinely dead code
      const contactName = userData
        ? generateContactName(userData.first_name, userData.last_name, userData.member_id)
        : 'Unknown Contact'

      // Check if this is a zero-value invoice (always AUTHORISED)
      if (invoiceRecord.net_amount === 0) {
        // Zero-value invoices are always AUTHORISED, no need to check payment status
      } else {
        // Non-zero invoices need payment verification
        if (!invoiceRecord.payment_id) {
          logger.logXeroSync('no-payment-id', 'No payment_id on non-zero invoice - skipping sync', { invoiceRecordId: invoiceRecord.id }, 'warn')
          return null
        }

        // Get payment status
        const { data: payment } = await this.supabase
          .from('payments')
          .select('status')
          .eq('id', invoiceRecord.payment_id)
          .single()

        if (!payment) {
          logger.logXeroSync('no-payment-record', 'No payment record found - skipping sync', { invoiceRecordId: invoiceRecord.id, paymentId: invoiceRecord.payment_id }, 'warn')
          return null
        }

        if (payment.status !== 'completed') {
          // Non-zero invoices with pending/failed payments should not be synced
          return null
        }
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

      // Calculate invoice due date
      // For payment plans: Due date = final payment date (to prevent "overdue" status before plan completes)
      // For regular invoices: Due date = 30 days from creation
      let dueDate: string

      // Check if this invoice is a payment plan by checking the is_payment_plan flag
      if (invoiceRecord.is_payment_plan) {
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
          logger.logXeroSync(
            'final-payment-date-lookup-failed',
            `Error fetching final payment date for payment plan invoice ${invoiceRecord.id} - falling back to default 30-day due date`,
            { invoiceRecordId: invoiceRecord.id, error: paymentError },
            'error'
          )
          dueDate = calculateDefaultDueDate(invoiceRecord.created_at)
        } else if (!finalPayment) {
          // No payments found (data integrity issue)
          logger.logXeroSync(
            'no-installment-payments',
            `No installment payments found for payment plan invoice ${invoiceRecord.id} - falling back to default 30-day due date, manual review required`,
            { invoiceRecordId: invoiceRecord.id },
            'error'
          )
          dueDate = calculateDefaultDueDate(invoiceRecord.created_at)
        } else {
          // Use the actual scheduled date of the final installment
          dueDate = finalPayment.planned_payment_date
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
      logger.logXeroSync('invoice-record-error', 'Error getting Xero invoice from record', { invoiceRecordId: invoiceRecord.id, error: error instanceof Error ? error.message : String(error) }, 'error')
      return null
    }
  }

  /**
   * Create a Xero credit note from a database record
   */
  async getXeroCreditNoteFromRecord(creditNoteRecord: XeroInvoiceRecord): Promise<CreditNote | null> {
    let activeTenant: { tenant_id: string; tenant_name: string; expires_at: string } | null = null

    try {
      // Get the active tenant for Xero sync
      const { getActiveTenant } = await import('./client')
      activeTenant = await getActiveTenant()

      if (!activeTenant) {
        logger.logXeroSync('no-active-tenant', 'No active Xero tenant available for credit note sync', { creditNoteRecordId: creditNoteRecord.id }, 'warn')
        // Don't mark as failed - leave as pending for when Xero is reconnected
        return null
      }

      // Parse staging metadata for refund details
      const metadata = creditNoteRecord.staging_metadata as XeroStagingMetadata | null
      if (!metadata || !metadata.refund_id) {
        logger.logXeroSync('no-refund-metadata', 'No refund metadata found in credit note record', { creditNoteRecordId: creditNoteRecord.id }, 'error')
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
        } catch {
          logger.logXeroSync('original-invoice-lookup-failed', 'Could not find original invoice number, using fallback', { creditNoteRecordId: creditNoteRecord.id }, 'debug')
        }
      }

      // Get or create Xero contact
      const contactResult = await getOrCreateXeroContact((metadata.customer?.id || metadata.user_id)!, activeTenant.tenant_id)
      if (!contactResult.success || !contactResult.xeroContactId) {
        logger.logXeroSync('contact-sync-failed', 'Failed to get/create Xero contact for credit note', { creditNoteRecordId: creditNoteRecord.id }, 'error')
        await this.markItemAsFailed(creditNoteRecord.id, 'Failed to get/create Xero contact')
        return null
      }

      // Build line items from database (not metadata)
      const lineItems: LineItem[] = []
      if (creditNoteRecord.line_items && Array.isArray(creditNoteRecord.line_items)) {
        // Use staged line items from database
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
        logger.logXeroSync('no-line-items', 'No line items found in database for credit note, using fallback', { creditNoteRecordId: creditNoteRecord.id }, 'warn')
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

      return creditNote

    } catch (error) {
      logger.logXeroSync('credit-note-record-error', 'Error creating Xero credit note from record', { creditNoteRecordId: creditNoteRecord.id, error: error instanceof Error ? error.message : String(error) }, 'error')
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
        logger.logXeroSync('missing-original-record', `No original record found for response index ${i}`, { index: i, tenantId }, 'error')
        continue
      }

      // Check if invoice has validation errors
      if (xeroInvoice.hasErrors || (xeroInvoice.validationErrors && xeroInvoice.validationErrors.length > 0)) {
        const errorMessages = xeroInvoice.validationErrors?.map(e => e.message).join('; ') || 'Unknown validation error'
        logger.logXeroSync('invoice-validation-failed', `Invoice validation failed for record ${originalRecord.id}`, { invoiceRecordId: originalRecord.id, errorMessages }, 'error')

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

    logger.logXeroSync('invoice-sync-completed', `Xero invoice sync completed: ${syncedCount} synced, ${failedCount} failed`, { syncedCount, failedCount, tenantId })
    return { success: true, synced: syncedCount, failed: failedCount }
    } catch (error: unknown) {
      logger.logXeroSync('invoice-batch-sync-error', 'Error syncing Xero invoices', { tenantId, error: error instanceof Error ? error.message : String(error) }, 'error')

      const errorBody = parseXeroBatchError(error)

      // Check if we have Elements array (batch error response)
      if (errorBody?.Elements && Array.isArray(errorBody.Elements)) {
        // Each Element is an invoice with ValidationErrors directly on it
        for (let i = 0; i < errorBody.Elements.length; i++) {
          const element = errorBody.Elements[i]
          const originalRecord = xeroInvoicesToSync[i]?.invoiceRecord

          if (!originalRecord) {
            logger.logXeroSync('missing-original-record', `No original record found for element index ${i}`, { index: i, tenantId }, 'error')
            continue
          }

          // Extract validation errors from the element
          const validationErrors = element.ValidationErrors || []
          if (validationErrors.length > 0) {
            const errorMessages = validationErrors.map((e) => e.Message).join('; ')
            logger.logXeroSync('invoice-validation-failed', `Invoice validation failed for record ${originalRecord.id}`, { invoiceRecordId: originalRecord.id, errorMessages }, 'error')

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
        const httpError = asHttpClientError(error)
        const errorMessage = httpError?.message
          || (httpError?.response as { statusText?: string } | undefined)?.statusText
          || 'Unknown error'
        logger.logXeroSync('invoice-batch-generic-error', 'Batch sync error (no Elements array)', { tenantId, errorMessage }, 'error')

        for (const item of xeroInvoicesToSync) {
          await this.markItemAsFailed(
            item.invoiceRecord.id,
            `Batch sync error: ${errorMessage}`
          )
          failedCount++
        }
      }

      logger.logXeroSync('invoice-sync-completed-with-errors', `Xero invoice sync completed with errors: ${syncedCount} synced, ${failedCount} failed`, { syncedCount, failedCount, tenantId }, 'warn')
      return { success: false, synced: syncedCount, failed: failedCount }
    }
  }

  /**
   * Sync credit notes to Xero using batch API
   */
  async syncXeroCreditNotes(xeroCreditNotesToSync: {xeroCreditNote: CreditNote, invoiceRecord: XeroInvoiceRecord}[], xeroApi: { accountingApi: AccountingApi }, tenantId: string): Promise<{ success: boolean; synced: number; failed: number }> {
    let syncedCount = 0
    let failedCount = 0

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
          logger.logXeroSync('missing-original-record', `No original record found for response index ${i}`, { index: i, tenantId }, 'error')
          continue
        }

        // Check if credit note has validation errors
        if (xeroCreditNote.hasErrors || (xeroCreditNote.validationErrors && xeroCreditNote.validationErrors.length > 0)) {
          const errorMessages = xeroCreditNote.validationErrors?.map(e => e.message).join('; ') || 'Unknown validation error'
          logger.logXeroSync('credit-note-validation-failed', `Credit note validation failed for record ${originalRecord.id}`, { creditNoteRecordId: originalRecord.id, errorMessages }, 'error')

          // Mark credit note as failed
          await this.markItemAsFailed(
            originalRecord.id,
            `Xero validation error: ${errorMessages}`
          )

          // Log failure
          await logXeroSync({
            tenant_id: tenantId,
            operation: 'credit_note_sync',
            record_type: 'credit_note',
            record_id: originalRecord.id,
            success: false,
            details: `Credit note sync failed: ${errorMessages}`,
            response_data: {
              validationErrors: xeroCreditNote.validationErrors,
              creditNote: xeroCreditNote
            },
            request_data: {
              creditNote: xeroCreditNotesToSync[i].xeroCreditNote
            }
          })

          failedCount++
          continue
        }

        // Mark credit note as synced in database (with error handling for database issues)
        try {
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

          syncedCount++
        } catch (dbError) {
          // Database error while marking as synced - credit note was created in Xero but database update failed
          const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown database error'
          logger.logXeroSync(
            'mark-credit-note-synced-db-failure',
            `CRITICAL: Credit note ${xeroCreditNote.creditNoteNumber} (${xeroCreditNote.creditNoteID}) was created in Xero but the database update failed - admin must manually set xero_invoice_id and sync_status on record id=${originalRecord.id} to match Xero`,
            {
              creditNoteRecordId: originalRecord.id,
              xeroCreditNoteId: xeroCreditNote.creditNoteID,
              xeroCreditNoteNumber: xeroCreditNote.creditNoteNumber,
              errorMessage
            },
            'warn'
          )
          // Mark as failed so admin can see it and take action
          await this.markItemAsFailed(
            originalRecord.id,
            `Credit note synced to Xero (${xeroCreditNote.creditNoteNumber}) but database update failed: ${errorMessage}`
          )

          await Sentry.captureException(dbError, {
            level: 'error',
            tags: {
              component: 'xero-batch-sync',
              operation: 'batch_credit_note_sync_success',
              critical: 'true'
            },
            extra: {
              context: 'credit_note_synced_to_xero_but_database_update_failed',
              creditNoteRecordId: originalRecord.id,
              xeroCreditNoteId: xeroCreditNote.creditNoteID,
              xeroCreditNoteNumber: xeroCreditNote.creditNoteNumber,
              batchIndex: i,
              tenantId,
              errorMessage: errorMessage
            }
          })

          failedCount++
        }
      }

      logger.logXeroSync('credit-note-sync-completed', `Xero credit note sync completed: ${syncedCount} synced, ${failedCount} failed`, { syncedCount, failedCount, tenantId })
      return { success: true, synced: syncedCount, failed: failedCount }
    } catch (error: unknown) {
      logger.logXeroSync('credit-note-batch-sync-error', 'Error syncing Xero credit notes', { tenantId, error: error instanceof Error ? error.message : String(error) }, 'error')

      const errorBody = parseXeroBatchError(error)

      // Check if we have Elements array (batch error response)
      if (errorBody?.Elements && Array.isArray(errorBody.Elements)) {
        // Each Element is a credit note with ValidationErrors directly on it
        for (let i = 0; i < errorBody.Elements.length; i++) {
          const element = errorBody.Elements[i]
          const originalRecord = xeroCreditNotesToSync[i]?.invoiceRecord

          if (!originalRecord) {
            logger.logXeroSync('missing-original-record', `No original record found for element index ${i}`, { index: i, tenantId }, 'error')
            continue
          }

          // Extract validation errors from the element
          const validationErrors = element.ValidationErrors || []
          if (validationErrors.length > 0) {
            const errorMessages = validationErrors.map((e) => e.Message).join('; ')
            logger.logXeroSync('credit-note-validation-failed', `Credit note validation failed for record ${originalRecord.id}`, { creditNoteRecordId: originalRecord.id, errorMessages }, 'error')

            // Mark credit note as failed with specific error
            await this.markItemAsFailed(
              originalRecord.id,
              `Xero validation error: ${errorMessages}`
            )

            // Log failure
            await logXeroSync({
              tenant_id: tenantId,
              operation: 'credit_note_sync',
              record_type: 'credit_note',
              record_id: originalRecord.id,
              success: false,
              details: `Credit note sync failed: ${errorMessages}`,
              response_data: {
                validationErrors: validationErrors,
                creditNote: element
              },
              request_data: {
                creditNote: xeroCreditNotesToSync[i]?.xeroCreditNote
              }
            })

            failedCount++
          } else {
            // This credit note succeeded - mark it as synced
            const xeroCreditNoteId = element.CreditNoteID
            const xeroCreditNoteNumber = element.CreditNoteNumber
            if (xeroCreditNoteId && xeroCreditNoteId !== '00000000-0000-0000-0000-000000000000' && xeroCreditNoteNumber) {
              await this.markItemAsSynced(originalRecord.id, xeroCreditNoteId, xeroCreditNoteNumber, tenantId)
              await logXeroSync({
                tenant_id: tenantId,
                operation: 'credit_note_sync',
                record_type: 'credit_note',
                record_id: originalRecord.id,
                success: true,
                details: `Credit note ${xeroCreditNoteNumber} synced successfully`,
                response_data: { creditNote: element }
              })

              syncedCount++
            }
          }
        }
      }

      return { success: false, synced: syncedCount, failed: failedCount }
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
          logger.logXeroSync('missing-original-payment-record', `No original payment record found for response index ${i}`, { index: i, tenantId }, 'error')
          continue
        }

        // Check for validation errors (like invoice sync does)
        if (xeroPayment.validationErrors && xeroPayment.validationErrors.length > 0) {
          const errorMessages = xeroPayment.validationErrors?.map(e => e.message).join('; ') || 'Unknown validation error'
          logger.logXeroSync('payment-validation-failed', `Payment validation failed for record ${originalRecord.id}`, { paymentRecordId: originalRecord.id, errorMessages }, 'error')

          // Mark payment as failed
          try {
            await this.markPaymentAsFailed(
              originalRecord.id,
              `Xero validation error: ${errorMessages}`
            )

            // Log failure
            await logXeroSync({
              tenant_id: tenantId,
              operation: 'payment_sync',
              record_type: 'payment',
              record_id: originalRecord.id,
              success: false,
              details: `Payment sync failed: ${errorMessages}`,
              response_data: {
                validationErrors: xeroPayment.validationErrors,
                payment: xeroPayment
              },
              request_data: {
                payment: xeroPayments[i]
              }
            })
          } catch (dbError) {
            Sentry.captureException(dbError, {
              level: 'error',
              tags: {
                component: 'xero-batch-sync',
                operation: 'batch_payment_validation_error',
                critical: 'true'
              },
              extra: {
                context: 'failed_to_mark_payment_as_failed_after_xero_validation_error_in_success_path',
                paymentRecordId: originalRecord.id,
                xeroValidationErrors: errorMessages,
                batchIndex: i,
                tenantId
              }
            })
            logger.logXeroSync('mark-payment-failed-db-error', `Failed to mark payment ${originalRecord.id} as failed in database`, { paymentRecordId: originalRecord.id, error: dbError instanceof Error ? dbError.message : String(dbError) }, 'warn')
          }

          continue // Skip to next payment
        }

        // Only mark as synced if NO errors
        try {
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
        } catch (dbError) {
          // Database error while marking as synced - log to Sentry and continue with batch
          Sentry.captureException(dbError, {
            level: 'error',
            tags: {
              component: 'xero-batch-sync',
              operation: 'batch_payment_sync_success',
              critical: 'true'
            },
            extra: {
              context: 'payment_synced_to_xero_but_database_update_failed',
              paymentRecordId: originalRecord.id,
              xeroPaymentId: xeroPayment.paymentID,
              batchIndex: i,
              tenantId
            }
          })
          logger.logXeroSync(
            'mark-payment-synced-db-failure',
            `Payment ${xeroPayment.paymentID} was successfully created in Xero but the database update failed - manual intervention required`,
            { paymentRecordId: originalRecord.id, xeroPaymentId: xeroPayment.paymentID, error: dbError instanceof Error ? dbError.message : String(dbError) },
            'warn'
          )
        }
      }

      return true
    } catch (error: unknown) {
      logger.logXeroSync('payment-batch-sync-error', 'Error syncing Xero payments', { tenantId, error: error instanceof Error ? error.message : String(error) }, 'error')

      const errorBody = parseXeroBatchError(error)

      // Check if we have Elements array (batch error response)
      if (errorBody?.Elements && Array.isArray(errorBody.Elements)) {
        // Validate array lengths match to prevent index misalignment
        if (errorBody.Elements.length !== paymentRecords.length) {
          logger.logXeroSync(
            'payment-elements-length-mismatch',
            `Array length mismatch: ${errorBody.Elements.length} elements vs ${paymentRecords.length} payment records - cannot safely correlate errors to payments, marking all as failed`,
            { elementsLength: errorBody.Elements.length, recordsLength: paymentRecords.length, tenantId },
            'error'
          )

          // Mark all payments as failed due to ambiguous error state
          for (const record of paymentRecords) {
            try {
              await this.markPaymentAsFailed(
                record.id,
                `Batch sync error: Array length mismatch (${errorBody.Elements.length} elements vs ${paymentRecords.length} records)`
              )
            } catch (dbError) {
              Sentry.captureException(dbError, {
                level: 'error',
                tags: {
                  component: 'xero-batch-sync',
                  operation: 'batch_payment_error_array_mismatch',
                  critical: 'true'
                },
                extra: {
                  context: 'failed_to_mark_payment_as_failed_after_array_mismatch',
                  paymentRecordId: record.id,
                  elementsLength: errorBody.Elements.length,
                  recordsLength: paymentRecords.length
                }
              })
              logger.logXeroSync('mark-payment-failed-db-error', `Failed to mark payment ${record.id} as failed in database`, { paymentRecordId: record.id, error: dbError instanceof Error ? dbError.message : String(dbError) }, 'warn')
            }
          }
          return false
        }

        // Each Element is a payment with ValidationErrors directly on it
        for (let i = 0; i < errorBody.Elements.length; i++) {
          const element = errorBody.Elements[i]
          const originalRecord = paymentRecords[i]

          if (!originalRecord) {
            logger.logXeroSync('missing-original-payment-record', `No original record found for element index ${i}`, { index: i, tenantId }, 'error')
            continue
          }

          // Extract validation errors from the element
          const validationErrors = element.ValidationErrors || []
          if (validationErrors.length > 0) {
            const errorMessages = validationErrors.map((e) => e.Message).join('; ')
            logger.logXeroSync('payment-validation-failed', `Payment validation failed for record ${originalRecord.id}`, { paymentRecordId: originalRecord.id, errorMessages }, 'error')

            // Mark payment as failed with specific error
            try {
              await this.markPaymentAsFailed(
                originalRecord.id,
                `Xero validation error: ${errorMessages}`
              )

              // Log failure
              await logXeroSync({
                tenant_id: tenantId,
                operation: 'payment_sync',
                record_type: 'payment',
                record_id: originalRecord.id,
                success: false,
                details: `Payment sync failed: ${errorMessages}`,
                response_data: {
                  validationErrors: validationErrors,
                  payment: element
                },
                request_data: {
                  payment: xeroPayments[i]
                }
              })
            } catch (dbError) {
              Sentry.captureException(dbError, {
                level: 'error',
                tags: {
                  component: 'xero-batch-sync',
                  operation: 'batch_payment_error_validation',
                  critical: 'true'
                },
                extra: {
                  context: 'failed_to_mark_payment_as_failed_after_xero_validation_error',
                  paymentRecordId: originalRecord.id,
                  xeroValidationErrors: errorMessages,
                  batchIndex: i
                }
              })
              logger.logXeroSync('mark-payment-failed-db-error', `Failed to mark payment ${originalRecord.id} as failed in database`, { paymentRecordId: originalRecord.id, error: dbError instanceof Error ? dbError.message : String(dbError) }, 'warn')
            }
          } else {
            // This payment succeeded - mark it as synced
            const xeroPaymentId = element.PaymentID
            if (xeroPaymentId && xeroPaymentId !== '00000000-0000-0000-0000-000000000000') {
              try {
                await this.markPaymentAsSynced(originalRecord.id, xeroPaymentId, tenantId)
                await logXeroSync({
                  tenant_id: tenantId,
                  operation: 'payment_sync',
                  record_type: 'payment',
                  record_id: originalRecord.id,
                  success: true,
                  details: `Payment synced successfully`,
                  response_data: { payment: element }
                })
              } catch (dbError) {
                Sentry.captureException(dbError, {
                  level: 'error',
                  tags: {
                    component: 'xero-batch-sync',
                    operation: 'batch_payment_error_recovery',
                    critical: 'true'
                  },
                  extra: {
                    context: 'payment_synced_to_xero_but_database_update_failed_in_error_recovery',
                    paymentRecordId: originalRecord.id,
                    xeroPaymentId,
                    batchIndex: i
                  }
                })
                logger.logXeroSync('mark-payment-synced-db-failure', `Failed to mark payment ${originalRecord.id} as synced in database`, { paymentRecordId: originalRecord.id, xeroPaymentId, error: dbError instanceof Error ? dbError.message : String(dbError) }, 'warn')
              }
            }
          }
        }
      } else {
        // Generic error - mark all payments in this batch as failed
        const httpError = asHttpClientError(error)
        const errorMessage = httpError?.message
          || (httpError?.response as { statusText?: string } | undefined)?.statusText
          || 'Unknown error'
        logger.logXeroSync('payment-batch-generic-error', 'Batch sync error (no Elements array)', { tenantId, errorMessage }, 'error')

        for (const record of paymentRecords) {
          try {
            await this.markPaymentAsFailed(
              record.id,
              `Batch sync error: ${errorMessage}`
            )
          } catch (dbError) {
            Sentry.captureException(dbError, {
              level: 'error',
              tags: {
                component: 'xero-batch-sync',
                operation: 'batch_payment_generic_error',
                critical: 'true'
              },
              extra: {
                context: 'failed_to_mark_payment_as_failed_after_generic_batch_error',
                paymentRecordId: record.id,
                batchErrorMessage: errorMessage
              }
            })
            logger.logXeroSync('mark-payment-failed-db-error', `Failed to mark payment ${record.id} as failed in database`, { paymentRecordId: record.id, error: dbError instanceof Error ? dbError.message : String(dbError) }, 'warn')
          }
        }
      }

      return false
    }
  }

  /**
   * Generate a Xero payment object from a payment record
   */
  async getXeroPaymentFromRecord(paymentRecord: XeroPaymentRecord): Promise<Payment | null> {
    let activeTenant: { tenant_id: string; tenant_name: string; expires_at: string } | null = null

    try {
      // Get the associated invoice/credit note record
      const { data: invoiceRecord } = await this.supabase
        .from('xero_invoices')
        .select('xero_invoice_id, invoice_number, invoice_type')
        .eq('id', paymentRecord.xero_invoice_id)
        .single()

      if (!invoiceRecord || !invoiceRecord.xero_invoice_id) {
        logger.logXeroSync('invoice-not-synced', 'Associated invoice not synced to Xero yet - skipping payment', { paymentRecordId: paymentRecord.id, xeroInvoiceId: paymentRecord.xero_invoice_id }, 'warn')
        await this.markPaymentAsFailed(paymentRecord.id, 'Associated invoice not synced to Xero yet')
        return null
      }

      const isInvoice = invoiceRecord.invoice_type === 'ACCREC'
      const isCreditNote = invoiceRecord.invoice_type === 'ACCRECCREDIT'

      // Get the active tenant for Xero sync
      const { getActiveTenant } = await import('./client')
      activeTenant = await getActiveTenant()

      if (!activeTenant) {
        logger.logXeroSync('no-active-tenant', 'No active Xero tenant available for payment sync', { paymentRecordId: paymentRecord.id }, 'warn')
        // Don't mark as failed - leave as pending for when Xero is reconnected
        return null
      }

      // Get authenticated Xero client using active tenant
      const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
      if (!xeroApi) {
        // Don't mark as failed - leave as pending for when Xero is reconnected
        logger.logXeroSync('auth-failed', 'Unable to authenticate with Xero - leaving payment as pending', { paymentRecordId: paymentRecord.id, tenantId: activeTenant.tenant_id }, 'warn')
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
        reference: paymentRecord.reference || (paymentRecord.staging_metadata as XeroStagingMetadata | null)?.stripe_charge_id || invoiceRecord.invoice_number || ''
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
      logger.logXeroSync('payment-record-error', 'Error getting Xero payment from record', { paymentRecordId: paymentRecord.id, error: error instanceof Error ? error.message : String(error) }, 'error')
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
    const updateData: Database['public']['Tables']['xero_invoices']['Update'] = {
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
      logger.logXeroSync('mark-invoice-synced-db-error', 'Error marking invoice as synced', { stagingId, xeroId, invoiceNumber: number, tenantId, error }, 'warn')

      // Report to Sentry as critical error - this indicates database infrastructure issue
      Sentry.captureException(error, {
        level: 'fatal',
        tags: {
          component: 'xero-batch-sync',
          operation: 'mark_invoice_synced',
          critical: 'true'
        },
        extra: {
          stagingId,
          xeroId,
          invoiceNumber: number,
          tenantId,
          errorMessage: error?.message || String(error),
          errorCode: error?.code || 'UNKNOWN'
        }
      })

      throw new Error(`Failed to mark invoice as synced in database: ${error?.message || String(error)}`)
    } else {
      logger.logXeroSync('invoice-marked-synced', 'Invoice marked as synced successfully', { stagingId, xeroId, invoiceNumber: number, tenantId, resultId: data?.[0]?.id }, 'debug')
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
    const updateData: Database['public']['Tables']['xero_payments']['Update'] = {
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
      logger.logXeroSync('mark-payment-synced-db-error', 'Error marking payment as synced', { stagingId, xeroPaymentId, tenantId, error }, 'warn')

      // Report to Sentry as critical error - this indicates database infrastructure issue
      Sentry.captureException(error, {
        level: 'fatal',
        tags: {
          component: 'xero-batch-sync',
          operation: 'mark_payment_synced',
          critical: 'true'
        },
        extra: {
          stagingId,
          xeroPaymentId,
          tenantId,
          errorMessage: error?.message || String(error),
          errorCode: error?.code || 'UNKNOWN'
        }
      })

      throw new Error(`Failed to mark payment as synced in database: ${error?.message || String(error)}`)
    } else {
      logger.logXeroSync('payment-marked-synced', 'Payment marked as synced successfully', { stagingId, xeroPaymentId, tenantId, resultId: data?.[0]?.id }, 'debug')
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
  private isRateLimitError(error: unknown): boolean {
    // Check for HTTP 429 status code
    if (getXeroErrorStatus(error) === 429) {
      return true
    }

    // Check for Xero-specific rate limit error messages
    const httpError = asHttpClientError(error)
    if (httpError?.message && typeof httpError.message === 'string') {
      const message = httpError.message.toLowerCase()
      return message.includes('rate limit') ||
             message.includes('429') ||
             message.includes('too many requests') ||
             message.includes('quota exceeded')
    }

    // Check for Xero API error structure
    const validationMessage = getXeroValidationMessage(error)
    if (validationMessage) {
      const lowerMessage = validationMessage.toLowerCase()
      return lowerMessage.includes('rate limit') ||
             lowerMessage.includes('429') ||
             lowerMessage.includes('too many requests')
    }

    return false
  }
}

// Export singleton instance
export const xeroBatchSyncManager = new XeroBatchSyncManager()
