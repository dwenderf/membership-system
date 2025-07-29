/**
 * Xero Batch Sync Manager
 * 
 * Handles syncing staged records to Xero API with retry logic and error handling
 */

import { Invoice, LineItem, Payment, CurrencyCode } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './client'
import { getOrCreateXeroContact, generateContactName } from './contacts'
import { createAdminClient } from '../supabase/server'
import { Database } from '../../types/database'
import { batchProcessor } from '../batch-processor'
import * as Sentry from '@sentry/nextjs'
import { getActiveXeroTenants, validateXeroConnection } from './client'

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
        payments: { synced: 0, failed: 0 }
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
      const activeTenants = await getActiveXeroTenants()
      if (activeTenants.length === 0) {
        console.log('⚠️ No active Xero tenants found - skipping sync to preserve pending status')
        return results
      }

      console.log(`🏢 Found ${activeTenants.length} active Xero tenant(s)`)

      // Validate connection to at least one tenant (only if we have records to sync)
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
      const lineItems: LineItem[] = invoiceRecord.line_items.map(item => ({
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
      let response
      let finalContactId = contactResult.xeroContactId
      
      try {
        response = await xeroApi.accountingApi.createInvoices(
          activeTenant.tenant_id,
          { invoices: [invoice] }
        )
      } catch (error: any) {
        // Check if this is an archived contact error
        if (error?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message?.includes('archived')) {
          console.log(`⚠️ Contact ${contactResult.xeroContactId} is archived, checking for other non-archived contacts first`)
          
          // Try to find and use a non-archived contact with the same email
          try {
            const { data: userData } = await this.supabase
              .from('users')
              .select('email, first_name, last_name, member_id')
              .eq('id', metadata.user_id)
              .single()

            if (userData) {
              // IMPROVED STRATEGY: Search by exact contact name first, then fall back to email search
              let nonArchivedContact: any = undefined
              
              // Step 1: Search by exact contact name first (including member ID)
              const expectedContactName = generateContactName(userData.first_name, userData.last_name, userData.member_id)
              
              console.log(`🔍 Searching for exact contact name: "${expectedContactName}"`)
              
              try {
                const nameSearchResponse = await xeroApi.accountingApi.getContacts(
                  activeTenant.tenant_id,
                  undefined,
                  `Name="${expectedContactName}"`
                )
                
                if (nameSearchResponse.body.contacts && nameSearchResponse.body.contacts.length > 0) {
                  const nameFoundContacts = nameSearchResponse.body.contacts
                  console.log(`✅ Found ${nameFoundContacts.length} contact(s) with exact name: "${expectedContactName}"`)
                  
                  // Find non-archived contact with exact name
                  nonArchivedContact = nameFoundContacts.find((contact: any) => 
                    contact.contactID !== contactResult.xeroContactId && // Exclude the archived one
                    contact.contactStatus !== 'ARCHIVED' // Must be non-archived
                  )
                  
                                     if (nonArchivedContact) {
                     console.log(`🎯 Found exact name match: "${nonArchivedContact.name}" (${nonArchivedContact.contactID})`)
                   } else {
                     // Check if we found an archived contact with exact name
                     const archivedContact = nameFoundContacts.find((contact: any) => 
                       contact.contactID !== contactResult.xeroContactId && // Exclude the current archived one
                       contact.contactStatus === 'ARCHIVED' // Must be archived
                     )
                     
                     if (archivedContact) {
                       console.log(`⚠️ Found archived contact with exact name: "${archivedContact.name}" (ID: ${archivedContact.contactID})`)
                       
                       // Rename the archived contact to avoid conflicts
                       try {
                         const archivedContactName = `${expectedContactName} - Archived`
                         console.log(`🔄 Renaming archived contact to: "${archivedContactName}"`)
                         
                         await xeroApi.accountingApi.updateContact(activeTenant.tenant_id, archivedContact.contactID!, {
                           contacts: [{
                             contactID: archivedContact.contactID,
                             name: archivedContactName,
                             firstName: userData.first_name,
                             lastName: userData.last_name,
                             emailAddress: userData.email,
                             contactStatus: 'ARCHIVED' as any // Keep it archived
                           }]
                         })
                         
                         console.log(`✅ Successfully renamed archived contact to: "${archivedContactName}"`)
                         
                       } catch (renameError) {
                         console.error(`❌ Failed to rename archived contact:`, renameError)
                       }
                     }
                   }
                }
              } catch (nameSearchError) {
                console.log(`❌ Name search failed for "${expectedContactName}":`, nameSearchError)
              }
              
              // Step 2: If no exact name match found, fall back to email search
              if (!nonArchivedContact) {
                console.log(`🔍 No exact name match found, searching by email: ${userData.email}`)
                
                const contactsResponse = await xeroApi.accountingApi.getContacts(
                  activeTenant.tenant_id,
                  undefined,
                  `EmailAddress="${userData.email}"`
                )

                const nonArchivedContacts = contactsResponse.body.contacts?.filter(
                  contact => contact.contactStatus !== 'ARCHIVED' as any
                ) || []

                console.log(`🔍 Found ${nonArchivedContacts.length} non-archived contacts with email ${userData.email}`)

                if (nonArchivedContacts.length > 0) {
                  // Try to find exact name match in email results
                  const exactMatch = nonArchivedContacts.find(contact => contact.name === expectedContactName)
                  nonArchivedContact = exactMatch || nonArchivedContacts[0]
                  
                  if (exactMatch) {
                    console.log(`🎯 Found exact name match in email results: "${exactMatch.name}" (${exactMatch.contactID})`)
                  } else {
                    console.log(`✅ Using first non-archived contact: "${nonArchivedContact.name}" (${nonArchivedContact.contactID})`)
                  }
                }
              }

              if (nonArchivedContact) {
                const contactToUse = nonArchivedContact

                console.log(`✅ Found non-archived contact: ${contactToUse.name} (ID: ${contactToUse.contactID})`)
                
                // Update the invoice with the non-archived contact
                finalContactId = contactToUse.contactID!
                invoice.contact = { contactID: finalContactId }
                
                // Retry the invoice creation
                response = await xeroApi.accountingApi.createInvoices(
                  activeTenant.tenant_id,
                  { invoices: [invoice] }
                )
                
                console.log(`✅ Successfully created invoice with non-archived contact: ${contactToUse.contactID}`)
              } else {
                // Re-throw the original error if no non-archived contacts found
                throw error
              }
            } else {
              // Re-throw the original error if user data not found
              throw error
            }
          } catch (recoveryError) {
            console.log('❌ Failed to recover from archived contact error:', recoveryError)
            throw error // Re-throw the original error
          }
        } else {
          // Re-throw non-archived contact errors
          throw error
        }
      }

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
                  contactID: finalContactId,
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
      
      // Extract detailed error information from Xero API response
      let errorMessage = 'Unknown error during Xero invoice sync'
      let errorCode = 'invoice_sync_failed'
      let validationErrors: string[] = []
      let xeroErrorDetails: any = {}
      
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (error && typeof error === 'object') {
        const xeroError = error as any
        
        // Extract Xero API error structure
        if (xeroError.response?.body?.Elements?.[0]?.ValidationErrors) {
          validationErrors = xeroError.response.body.Elements[0].ValidationErrors.map((err: any) => err.Message)
          errorMessage = `Xero validation errors: ${validationErrors.join(', ')}`
          errorCode = 'xero_validation_error'
          xeroErrorDetails = {
            xeroErrorNumber: xeroError.response.body.ErrorNumber,
            xeroErrorType: xeroError.response.body.Type,
            validationErrors: xeroError.response.body.Elements?.[0]?.ValidationErrors
          }
        } else if (xeroError.response?.body?.Message) {
          errorMessage = `Xero API error: ${xeroError.response.body.Message}`
          errorCode = 'xero_api_error'
          xeroErrorDetails = {
            xeroErrorNumber: xeroError.response.body.ErrorNumber,
            xeroErrorType: xeroError.response.body.Type
          }
        } else if (xeroError.message) {
          errorMessage = xeroError.message
        } else {
          errorMessage = `Xero error: ${JSON.stringify(xeroError).substring(0, 200)}...`
        }
      }
      
      await this.markInvoiceAsFailed(invoiceRecord.id, errorMessage)
      
      // Enhanced Sentry logging with detailed context
      const { captureSentryError } = await import('../sentry-helpers')
      await captureSentryError(error instanceof Error ? error : new Error(String(error)), {
        tags: {
          integration: 'xero',
          operation: 'invoice_sync',
          error_code: errorCode,
          tenant_id: activeTenant?.tenant_id || 'unknown'
        },
        extra: {
          invoice_id: invoiceRecord.id,
          invoice_number: invoiceRecord.invoice_number,
          payment_id: invoiceRecord.payment_id,
          tenant_id: activeTenant?.tenant_id,
          tenant_name: activeTenant?.tenant_name,
          user_id: (invoiceRecord.staging_metadata as any)?.user_id,
          net_amount: invoiceRecord.net_amount,
          error_code: errorCode,
          error_message: errorMessage,
          validation_errors: validationErrors,
          xero_error_details: xeroErrorDetails,
          line_items: invoiceRecord.line_items?.map(item => ({
            description: item.description,
            accounting_code: item.account_code,
            amount: item.line_amount
          }))
        }
      })
      
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
    let activeTenant: { tenant_id: string; tenant_name: string; expires_at: string } | null = null
    
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
        .select('xero_invoice_id')
        .eq('id', paymentRecord.xero_invoice_id)
        .single()

      if (!invoiceRecord || !invoiceRecord.xero_invoice_id) {
        console.log('❌ Associated invoice not synced to Xero yet - skipping payment')
        await this.markPaymentAsFailed(paymentRecord.id, 'Associated invoice not synced to Xero yet')
        return false
      }

      console.log('📄 Found associated invoice:', invoiceRecord.xero_invoice_id)

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
        console.log('⚠️ Unable to authenticate with Xero - leaving payment as pending:', paymentRecord.id)
        return false
      }

      // Check if invoice is already paid before attempting to create payment
      try {
        const invoiceResponse = await xeroApi.accountingApi.getInvoice(
          activeTenant.tenant_id,
          invoiceRecord.xero_invoice_id
        )
        
        if (invoiceResponse.body.invoices && invoiceResponse.body.invoices.length > 0) {
          const xeroInvoice = invoiceResponse.body.invoices[0]
          const amountDue = xeroInvoice.amountDue || 0
          const amountPaid = xeroInvoice.amountPaid || 0
          const status = xeroInvoice.status
          
          console.log('📊 Invoice status check:', {
            invoiceId: invoiceRecord.xero_invoice_id,
            status: status,
            amountDue: amountDue,
            amountPaid: amountPaid,
            paymentAmount: paymentRecord.amount_paid / 100
          })
          
          // If invoice is already paid or amount due is less than payment amount, skip payment creation
          if (status?.toString() === 'PAID' || amountDue === 0 || amountDue < (paymentRecord.amount_paid / 100)) {
            console.log('✅ Invoice already paid - marking payment as synced without creating duplicate payment')
            await this.markPaymentAsSynced(paymentRecord.id, `already_paid_${Date.now()}`, activeTenant.tenant_id)
            
            await logXeroSync({
              tenant_id: activeTenant.tenant_id,
              operation: 'payment_sync',
              record_type: 'payment',
              record_id: paymentRecord.id,
              xero_id: `already_paid_${Date.now()}`,
              success: true,
              details: `Payment skipped - invoice already paid (status: ${status}, amountDue: ${amountDue}, amountPaid: ${amountPaid})`,
              response_data: {
                invoice_status: status,
                amount_due: amountDue,
                amount_paid: amountPaid
              },
              request_data: {
                payment_amount: paymentRecord.amount_paid / 100,
                invoice_id: invoiceRecord.xero_invoice_id
              }
            })
            
            return true
          }
        }
      } catch (invoiceCheckError) {
        console.log('⚠️ Could not check invoice status - proceeding with payment creation:', invoiceCheckError)
        // Continue with payment creation if we can't check invoice status
      }

      // Get the Stripe bank account code from system_accounting_codes
      const { data: stripeAccountCode } = await this.supabase
        .from('system_accounting_codes')
        .select('accounting_code')
        .eq('code_type', 'stripe_bank_account')
        .single()

      const bankAccountCode = paymentRecord.bank_account_code || stripeAccountCode?.accounting_code || '090'

      // Create payment object
      const payment: Payment = {
        invoice: {
          invoiceID: invoiceRecord.xero_invoice_id
        },
        account: {
          code: bankAccountCode
        },
        amount: paymentRecord.amount_paid / 100, // Convert cents to dollars
        date: new Date().toISOString().split('T')[0],
        reference: paymentRecord.reference || ((paymentRecord.staging_metadata as any)?.stripe_payment_intent_id || '')
      }

      console.log('📤 Creating payment in Xero:', {
        invoiceId: invoiceRecord.xero_invoice_id,
        amount: payment.amount,
        accountCode: payment.account?.code || 'STRIPE',
        reference: payment.reference
      })

      // Create payment in Xero
      const response = await xeroApi.accountingApi.createPayments(
        activeTenant.tenant_id,
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
          await this.markPaymentAsSynced(paymentRecord.id, xeroPayment.paymentID, activeTenant.tenant_id)

          // Log success
          await logXeroSync({
            tenant_id: activeTenant.tenant_id,
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
                account: { code: bankAccountCode },
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
      throw new Error('Invalid response from Xero API')

    } catch (error) {
      console.error('❌ Error syncing payment to Xero:', error)
      
      // Check if this is a rate limit error
      const isRateLimitError = this.isRateLimitError(error)
      
      if (isRateLimitError) {
        console.log('🚫 Rate limit exceeded - leaving payment as pending for retry')
        // Don't mark as failed - leave as pending so it can be retried later
        return false
      }
      
      // Extract detailed error information from Xero API response
      let errorMessage = 'Unknown error during Xero payment sync'
      let errorCode = 'payment_sync_failed'
      let validationErrors: string[] = []
      let xeroErrorDetails: any = {}
      
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (error && typeof error === 'object') {
        const xeroError = error as any
        
        // Extract Xero API error structure
        if (xeroError.response?.body?.Elements?.[0]?.ValidationErrors) {
          validationErrors = xeroError.response.body.Elements[0].ValidationErrors.map((err: any) => err.Message)
          errorMessage = `Xero validation errors: ${validationErrors.join(', ')}`
          errorCode = 'xero_validation_error'
          xeroErrorDetails = {
            xeroErrorNumber: xeroError.response.body.ErrorNumber,
            xeroErrorType: xeroError.response.body.Type,
            validationErrors: xeroError.response.body.Elements?.[0]?.ValidationErrors
          }
        } else if (xeroError.response?.body?.Message) {
          errorMessage = `Xero API error: ${xeroError.response.body.Message}`
          errorCode = 'xero_api_error'
          xeroErrorDetails = {
            xeroErrorNumber: xeroError.response.body.ErrorNumber,
            xeroErrorType: xeroError.response.body.Type
          }
        } else if (xeroError.message) {
          errorMessage = xeroError.message
        } else {
          errorMessage = `Xero error: ${JSON.stringify(xeroError).substring(0, 200)}...`
        }
      }
      
      await this.markPaymentAsFailed(paymentRecord.id, errorMessage)
      
      // Enhanced Sentry logging with detailed context
      const { captureSentryError } = await import('../sentry-helpers')
      await captureSentryError(error instanceof Error ? error : new Error(String(error)), {
        tags: {
          integration: 'xero',
          operation: 'payment_sync',
          error_code: errorCode,
          tenant_id: activeTenant?.tenant_id || 'unknown'
        },
        extra: {
          payment_id: paymentRecord.id,
          xero_invoice_id: paymentRecord.xero_invoice_id,
          amount_paid: paymentRecord.amount_paid,
          bank_account_code: paymentRecord.bank_account_code,
          tenant_id: activeTenant?.tenant_id,
          tenant_name: activeTenant?.tenant_name,
          error_code: errorCode,
          error_message: errorMessage,
          validation_errors: validationErrors,
          xero_error_details: xeroErrorDetails
        }
      })
      
      // Log to Xero sync logs
      await logXeroSync({
        tenant_id: activeTenant?.tenant_id || '',
        operation: 'payment_sync',
        record_type: 'payment',
        record_id: paymentRecord.id,
        success: false,
        error_message: errorMessage
      })

      // Re-throw the error so the batch processor treats it as a failure
      throw error
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