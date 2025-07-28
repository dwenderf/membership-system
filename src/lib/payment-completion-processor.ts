/**
 * Payment Completion Processor
 * 
 * Handles the completion of payments and purchases by:
 * - Creating or updating Xero staging records
 * - Coordinating with EmailProcessor for confirmation emails
 * - Syncing pending Xero records
 * - Updating discount usage tracking
 * 
 * ARCHITECTURE:
 * This processor orchestrates the payment completion flow and delegates
 * email processing to the dedicated EmailProcessor class.
 * 
 * EMAIL FLOW (DELEGATED TO EMAILPROCESSOR):
 * - Zero-dollar purchases: Send confirmation email immediately (free_membership, free_registration)
 * - Paid purchases: Send confirmation email when payment completes (stripe_webhook_membership, stripe_webhook_registration)
 * - Failed payments: Send failure notification email
 * - Waitlist emails: Sent directly from join-waitlist endpoint (not payment-related)
 * 
 * FLOW:
 * 1. Stripe webhook receives payment completion → calls processPaymentCompletion
 * 2. Zero-value purchase completes → calls processPaymentCompletion
 * 3. Payment fails → calls processPaymentCompletion with failed metadata
 * 
 * USAGE:
 * ```ts
 * // From Stripe webhook
 * const event = paymentProcessor.createPaymentEvent(payment)
 * await paymentProcessor.processPaymentCompletion(event)
 * 
 * // From zero-value purchase
 * const event = paymentProcessor.createMembershipEvent(membership)
 * await paymentProcessor.processPaymentCompletion(event)
 * 
 * // From failed payment
 * const event = paymentProcessor.createFailedPaymentEvent(payment, 'Card declined')
 * await paymentProcessor.processPaymentCompletion(event)
 * ```
 * 
 * XERO STAGING LOGIC:
 * - Zero-value purchases: Create new staging records with AUTHORISED status
 * - Paid purchases: Update existing staging records (created during purchase) to AUTHORISED
 * - Failed payments: Update staging records to DRAFT with error details
 */

import { xeroStagingManager } from '@/lib/xero/staging'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync'
import { emailProcessor } from '@/lib/email'
import { Logger } from '@/lib/logging/logger'

type PaymentCompletionEvent = {
  event_type: 'payments' | 'user_memberships' | 'user_registrations'
  record_id: string | null
  user_id: string
  payment_id: string | null
  amount: number
  trigger_source: string
  timestamp: string
  metadata?: {
    payment_intent_id?: string
    failure_reason?: string
    failed?: boolean
  }
}

export class PaymentCompletionProcessor {
  private supabase: any
  private logger: Logger

  constructor() {
    this.logger = Logger.getInstance()
  }

  /**
   * Initialize the processor
   */
  private async initialize() {
    if (!this.supabase) {
      // Use admin client for system operations to bypass RLS
      const { createAdminClient } = await import('./supabase/server')
      this.supabase = createAdminClient()
    }
  }

  /**
   * Process a payment completion event (core logic)
   * 
   * This is the main entry point called from:
   * - Stripe webhooks for paid purchases
   * - Direct calls for zero-value purchases
   * - Failed payment handling
   * 
   * The processor orchestrates the payment completion flow and delegates
   * email processing to the dedicated EmailProcessor class.
   */
  async processPaymentCompletion(event: PaymentCompletionEvent) {
    try {
      this.logger.logPaymentProcessing('process-payment-completion', `🔄 Processing ${event.trigger_source} completion...`)

      // Handle failed payments differently
      if (event.metadata?.failed) {
        this.logger.logPaymentProcessing('process-payment-completion', '❌ Processing failed payment event')
        await emailProcessor.sendFailedPaymentEmails(event)
        this.logger.logPaymentProcessing('process-payment-completion', `✅ Completed processing failed ${event.trigger_source}`)
        return
      }

      // Phase 1: Handle Xero staging records (create new or update existing)
      await this.handleXeroStagingRecords(event)

      // Phase 2: Process confirmation emails (delegated to EmailProcessor)
      await emailProcessor.processConfirmationEmails(event)

      // Phase 3: Process staged emails immediately (delegated to EmailProcessor)
      await emailProcessor.processStagedEmails()

      // Phase 4: Batch sync pending Xero records
      await this.syncPendingXeroRecords()

      // Phase 5: Update discount usage tracking
      await this.updateDiscountUsage(event)

      this.logger.logPaymentProcessing('process-payment-completion', `✅ Completed processing ${event.trigger_source}`)
    } catch (error) {
      this.logger.logPaymentProcessing('process-payment-completion', `❌ Error processing payment completion`, { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      
      // TODO: Log to Sentry for monitoring
      // await logToSentry(error, { event })
    }
  }

  /**
   * Phase 1: Handle Xero staging records (create new or update existing)
   * 
   * Flow:
   * - Zero-value purchases (amount = 0): Create new staging records immediately
   * - Paid purchases (amount > 0): Update existing staging records created during purchase
   * 
   * ID Relationships:
   * - record_id: ID from user_memberships or user_registrations tables
   * - payment_id: ID from payments table (null for zero-value purchases)
   * - xero_invoices.id: Primary key of the Xero staging record itself
   */
  private async handleXeroStagingRecords(event: PaymentCompletionEvent) {
    this.logger.logPaymentProcessing('handle-xero-staging-records', '📊 Handling Xero staging records...')
    
    try {
      // Check for existing staging records first (needed for both zero and paid purchases)
      const existingStagingRecords = await this.findExistingStagingRecords(event)
      
      // For zero-value purchases: Check for existing staging records first, then create if needed
      if (event.amount === 0) {
        if (!event.record_id) {
          this.logger.logPaymentProcessing('handle-xero-staging-records', '⚠️ No record_id for zero-value purchase, skipping Xero staging', undefined, 'warn')
          return
        }
        
        if (existingStagingRecords) {
          this.logger.logPaymentProcessing('handle-xero-staging-records', '🆓 Updating existing Xero staging records for zero-value purchase')
          await this.updateXeroStagingRecords(event, existingStagingRecords, { success: true })
        } else {
          this.logger.logPaymentProcessing('handle-xero-staging-records', '🆓 Creating new Xero staging records for zero-value purchase')
          await this.createXeroStagingRecords(event)
        }
        return
      }

      // For paid purchases: Update existing staging records
      if (!event.payment_id) {
        this.logger.logPaymentProcessing('handle-xero-staging-records', '⚠️ No payment_id for paid purchase, skipping Xero staging', undefined, 'warn')
        return
      }

      if (existingStagingRecords) {
        this.logger.logPaymentProcessing('handle-xero-staging-records', '💰 Updating existing Xero staging records for paid purchase')
        await this.updateXeroStagingRecords(event, existingStagingRecords, { success: true })
      } else {
        this.logger.logPaymentProcessing('handle-xero-staging-records', '⚠️ No existing staging records found for paid purchase - this should not happen in normal flow', undefined, 'warn')
        // Fallback: create staging records (this shouldn't happen in normal flow)
        await this.createXeroStagingRecords(event)
      }
      
    } catch (error) {
      this.logger.logPaymentProcessing('handle-xero-staging-records', '❌ Failed to handle Xero staging records', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      throw error
    }
  }

  /**
   * Find existing staging records for this event
   * 
   * Looks for Xero staging records by:
   * - payment_id (for paid purchases that have staging records)
   * - user_id in staging_metadata (for staged records that don't have payment_id yet)
   * - record_id (for zero-value purchases that might have staging records)
   * 
   * Returns the first matching record or null if none found.
   */
  private async findExistingStagingRecords(event: PaymentCompletionEvent) {
    try {
      await this.initialize()
      
      this.logger.logPaymentProcessing('find-existing-staging-records', '🔍 Searching for existing staging records', {
        payment_id: event.payment_id,
        record_id: event.record_id,
        user_id: event.user_id,
        trigger_source: event.trigger_source
      })
      
      // For zero-value purchases, we need to find the payment record first
      let paymentId = event.payment_id
      if (!paymentId && event.record_id) {
        // Find the payment record associated with this registration/membership
        const paymentQuery = event.trigger_source === 'user_registrations' || event.trigger_source === 'free_registration'
          ? this.supabase.from('user_registrations').select('payment_id').eq('id', event.record_id).single()
          : this.supabase.from('user_memberships').select('payment_id').eq('id', event.record_id).single()
        
        const { data: recordData, error: recordError } = await paymentQuery
        
        if (recordError) {
          this.logger.logPaymentProcessing('find-existing-staging-records', '❌ Error finding payment record', { error: recordError }, 'error')
          return null
        }
        
        paymentId = recordData?.payment_id
        this.logger.logPaymentProcessing('find-existing-staging-records', '🔍 Found payment_id from record', {
          record_id: event.record_id,
          payment_id: paymentId
        })
      }
      
      // First, try to find staging records by payment_id (for records that have been updated)
      if (paymentId) {
        const { data: existingInvoicesByPaymentId, error: paymentIdError } = await this.supabase
          .from('xero_invoices')
          .select('*')
          .eq('payment_id', paymentId)
          .in('sync_status', ['staged', 'pending', 'synced'])
          .limit(1)
        
        if (paymentIdError) {
          this.logger.logPaymentProcessing('find-existing-staging-records', '❌ Database error finding staging records by payment_id', { error: paymentIdError }, 'error')
        } else if (existingInvoicesByPaymentId && existingInvoicesByPaymentId.length > 0) {
          this.logger.logPaymentProcessing('find-existing-staging-records', '🔍 Found staging records by payment_id', {
            found: true,
            count: existingInvoicesByPaymentId.length,
            firstRecord: {
              id: existingInvoicesByPaymentId[0].id,
              payment_id: existingInvoicesByPaymentId[0].payment_id,
              sync_status: existingInvoicesByPaymentId[0].sync_status,
              invoice_status: existingInvoicesByPaymentId[0].invoice_status
            }
          })
          return existingInvoicesByPaymentId[0]
        }
      }
      
      // If no records found by payment_id, try to find staged records by user_id in staging_metadata
      // This handles the case where staging records were created but payment_id hasn't been set yet
      const { data: existingInvoicesByUserId, error: userIdError } = await this.supabase
        .from('xero_invoices')
        .select('*')
        .eq('staging_metadata->>user_id', event.user_id)
        .eq('sync_status', 'staged')
        .is('payment_id', null)
        .limit(1)
      
      if (userIdError) {
        this.logger.logPaymentProcessing('find-existing-staging-records', '❌ Database error finding staging records by user_id', { error: userIdError }, 'error')
      } else if (existingInvoicesByUserId && existingInvoicesByUserId.length > 0) {
        this.logger.logPaymentProcessing('find-existing-staging-records', '🔍 Found staging records by user_id in metadata', {
          found: true,
          count: existingInvoicesByUserId.length,
          firstRecord: {
            id: existingInvoicesByUserId[0].id,
            payment_id: existingInvoicesByUserId[0].payment_id,
            sync_status: existingInvoicesByUserId[0].sync_status,
            invoice_status: existingInvoicesByUserId[0].invoice_status
          }
        })
        return existingInvoicesByUserId[0]
      }
      
      // Also check for invoice-first flow records that already have xero_invoice_id but need payment_id updated
      const { data: existingInvoicesByXeroId, error: xeroIdError } = await this.supabase
        .from('xero_invoices')
        .select('*')
        .not('xero_invoice_id', 'is', null)
        .eq('staging_metadata->>user_id', event.user_id)
        .is('payment_id', null)
        .limit(1)
      
      if (xeroIdError) {
        this.logger.logPaymentProcessing('find-existing-staging-records', '❌ Database error finding invoice-first records by xero_invoice_id', { error: xeroIdError }, 'error')
      } else if (existingInvoicesByXeroId && existingInvoicesByXeroId.length > 0) {
        this.logger.logPaymentProcessing('find-existing-staging-records', '🔍 Found invoice-first records by xero_invoice_id', {
          found: true,
          count: existingInvoicesByXeroId.length,
          firstRecord: {
            id: existingInvoicesByXeroId[0].id,
            payment_id: existingInvoicesByXeroId[0].payment_id,
            xero_invoice_id: existingInvoicesByXeroId[0].xero_invoice_id,
            sync_status: existingInvoicesByXeroId[0].sync_status,
            invoice_status: existingInvoicesByXeroId[0].invoice_status
          }
        })
        return existingInvoicesByXeroId[0]
      }
      
      this.logger.logPaymentProcessing('find-existing-staging-records', '🔍 No staging records found', {
        found: false,
        searchedByPaymentId: !!paymentId,
        searchedByUserId: true
      })
      
      return null
    } catch (error) {
      this.logger.logPaymentProcessing('find-existing-staging-records', '❌ Error finding existing staging records', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      return null
    }
  }

  /**
   * Update existing Xero staging records after payment completion
   * 
   * This method is called for paid purchases (amount > 0) when staging records
   * already exist from the initial purchase flow. It updates the records to reflect
   * the payment outcome.
   * 
   * @param event - The payment completion event
   * @param existingRecords - The existing Xero staging record to update
   * @param options - Update options including success status and error message
   */
  private async updateXeroStagingRecords(
    event: PaymentCompletionEvent, 
    existingRecords: any,
    options: {
      success: boolean
      error?: string
    }
  ) {
    this.logger.logPaymentProcessing('update-xero-staging-records', '🔄 Updating Xero staging records...')
    
    try {
      await this.initialize()
      const updateData = {
        sync_status: options.success ? 'pending' : 'failed',
        invoice_status: options.success ? 'AUTHORISED' : 'DRAFT',
        payment_id: options.success ? event.payment_id : null,
        sync_error: options.success ? null : options.error,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      // Update the invoice record
      const { error: updateError } = await this.supabase
        .from('xero_invoices')
        .update(updateData)
        .eq('id', existingRecords.id)

      if (updateError) {
        this.logger.logPaymentProcessing('update-xero-staging-records', '❌ Error updating Xero staging records', { error: updateError }, 'error')
        throw updateError
      }

      // Also update the corresponding payment record if it exists
      if (event.payment_id && options.success) {
        // Get the latest bank account code from system accounting codes
        const { data: systemCode } = await this.supabase
          .from('system_accounting_codes')
          .select('accounting_code')
          .eq('code_type', 'stripe_bank_account')
          .single()
        
        const bankAccountCode = systemCode?.accounting_code || '090' // Fallback to 090
        
        // Update payment staging metadata to include payment_id
        const { data: existingPaymentRecord } = await this.supabase
          .from('xero_payments')
          .select('staging_metadata')
          .eq('xero_invoice_id', existingRecords.id)
          .eq('sync_status', 'staged')
          .single()
        
        const updatedPaymentMetadata = {
          ...existingPaymentRecord?.staging_metadata,
          payment_id: event.payment_id,
          updated_at: new Date().toISOString()
        }
        
        const paymentUpdateData = {
          sync_status: 'pending',
          sync_error: null,
          bank_account_code: bankAccountCode, // Update with latest code
          staging_metadata: updatedPaymentMetadata,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        const { error: paymentUpdateError } = await this.supabase
          .from('xero_payments')
          .update(paymentUpdateData)
          .eq('xero_invoice_id', existingRecords.id)

        if (paymentUpdateError) {
          this.logger.logPaymentProcessing('update-xero-staging-records', '⚠️ Warning: Error updating payment staging record', { error: paymentUpdateError }, 'warn')
          // Don't throw error for payment update - invoice update was successful
        } else {
          this.logger.logPaymentProcessing('update-xero-staging-records', '✅ Payment staging record updated successfully')
        }
      }

      this.logger.logPaymentProcessing('update-xero-staging-records', `✅ Xero staging records updated successfully (${options.success ? 'success' : 'failed'})`)
      
    } catch (error) {
      this.logger.logPaymentProcessing('update-xero-staging-records', '❌ Failed to update Xero staging records', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      throw error
    }
  }

  /**
   * Create Xero staging records (primarily for zero-value purchases)
   * 
   * This method is called when:
   * - Zero-value purchases (amount = 0): Create new staging records with AUTHORISED status
   * - Fallback for paid purchases: If no existing staging records found (shouldn't happen in normal flow)
   * 
   * For zero-value purchases, this creates staging records that will be immediately synced to Xero
   * with AUTHORISED status since no payment processing is needed.
   */
  private async createXeroStagingRecords(event: PaymentCompletionEvent) {
    this.logger.logPaymentProcessing('create-xero-staging-records', '📊 Creating Xero staging records...')
    
    try {
      // Skip Xero staging if no record_id (e.g., malformed events)
      if (!event.record_id) {
        this.logger.logPaymentProcessing('create-xero-staging-records', '⚠️ No record_id, skipping Xero staging creation', undefined, 'warn')
        return
      }

      // For zero-value purchases, create staging records with AUTHORISED status
      if (event.amount === 0) {
        await this.createFreeXeroStaging(event)
      } else {
        // This shouldn't happen in the new flow, but keep as fallback
        this.logger.logPaymentProcessing('create-xero-staging-records', '⚠️ Unexpected: Creating staging for paid purchase in createXeroStagingRecords', undefined, 'warn')
        const paymentData = await this.getPaymentData(event)
        if (paymentData) {
          await this.createPaidXeroStaging(event, paymentData)
        }
      }
      
    } catch (error) {
      this.logger.logPaymentProcessing('create-xero-staging-records', '❌ Failed to create Xero staging records', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      throw error
    }
  }

  /**
   * Create Xero staging for free purchases
   */
  private async createFreeXeroStaging(event: PaymentCompletionEvent) {
    this.logger.logPaymentProcessing('create-free-xero-staging', '🆓 Creating Xero staging for free purchase...')
    
    try {
      // Ensure record_id is not null
      if (!event.record_id) {
        this.logger.logPaymentProcessing('create-free-xero-staging', '⚠️ No record ID for free purchase staging', undefined, 'warn')
        return
      }

      const success = await xeroStagingManager.createFreePurchaseStaging({
        user_id: event.user_id,
        record_id: event.record_id,
        trigger_source: event.trigger_source as 'user_memberships' | 'user_registrations'
      })
      
      if (success) {
        this.logger.logPaymentProcessing('create-free-xero-staging', '✅ Free purchase Xero staging created successfully')
      } else {
        this.logger.logPaymentProcessing('create-free-xero-staging', '❌ Free purchase Xero staging failed - CRITICAL ERROR', undefined, 'error')
        throw new Error('Xero staging failed - registration cannot proceed without Xero integration')
      }
    } catch (error) {
      this.logger.logPaymentProcessing('create-free-xero-staging', '❌ Error creating free Xero staging', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
    }
  }

  /**
   * Create Xero staging for paid purchases
   */
  private async createPaidXeroStaging(event: PaymentCompletionEvent, paymentData: any) {
    this.logger.logPaymentProcessing('create-paid-xero-staging', '💰 Creating Xero staging for paid purchase...')
    
    try {
      const success = await xeroStagingManager.createPaidPurchaseStaging(event.payment_id!)
      
      if (success) {
        this.logger.logPaymentProcessing('create-paid-xero-staging', '✅ Paid purchase Xero staging created successfully')
      } else {
        this.logger.logPaymentProcessing('create-paid-xero-staging', '❌ Paid purchase Xero staging failed - CRITICAL ERROR', undefined, 'error')
        throw new Error('Xero staging failed - registration cannot proceed without Xero integration')
      }
    } catch (error) {
      this.logger.logPaymentProcessing('create-paid-xero-staging', '❌ Error creating paid Xero staging', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
    }
  }





  /**
   * Phase 2: Sync pending Xero records
   */
  private async syncPendingXeroRecords() {
    this.logger.logPaymentProcessing('sync-pending-xero-records', '🔄 Syncing pending Xero records...')
    
    try {
      // Use the Xero batch sync manager to sync all pending records
      const results = await xeroBatchSyncManager.syncAllPendingRecords()
      
      this.logger.logPaymentProcessing('sync-pending-xero-records', '📊 Xero sync results:', {
        invoices: `${results.invoices.synced} synced, ${results.invoices.failed} failed`,
        payments: `${results.payments.synced} synced, ${results.payments.failed} failed`
      })
      
    } catch (error) {
      this.logger.logPaymentProcessing('sync-pending-xero-records', '❌ Failed to sync pending Xero records:', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      // Don't throw - Xero sync failures shouldn't break other processing
    }
  }



  /**
   * Phase 5: Update discount usage tracking
   */
  private async updateDiscountUsage(event: PaymentCompletionEvent) {
    this.logger.logPaymentProcessing('update-discount-usage', '🎫 Updating discount usage...')
    
    try {
      // TODO: Implement discount usage tracking for memberships
      // Registrations already have this implemented in their flow
      
      if (event.trigger_source === 'user_memberships') {
        this.logger.logPaymentProcessing('update-discount-usage', '🚧 Membership discount usage tracking - to be implemented', undefined, 'warn')
      } else {
        this.logger.logPaymentProcessing('update-discount-usage', '✅ Registration discount usage already handled in registration flow')
      }
      
    } catch (error) {
      this.logger.logPaymentProcessing('update-discount-usage', '❌ Failed to update discount usage:', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      // Don't throw - discount tracking failures shouldn't break other processing
    }
  }

  /**
   * Get payment data for processing
   */
  private async getPaymentData(event: PaymentCompletionEvent) {
    if (event.payment_id) {
      const { data } = await this.supabase
        .from('payments')
        .select('*')
        .eq('id', event.payment_id)
        .single()
      return data
    }

    // For free purchases, we might not have a payment record
    return null
  }









  /**
   * Manual batch processing for failed records
   */
  async processPendingRecords() {
    this.logger.logPaymentProcessing('process-pending-records', '🔄 Starting manual batch processing...')
    
    try {
      // Find all pending Xero records and retry them
      await this.syncPendingXeroRecords()
      
      this.logger.logPaymentProcessing('process-pending-records', '✅ Manual batch processing completed')
    } catch (error) {
      this.logger.logPaymentProcessing('process-pending-records', '❌ Manual batch processing failed:', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
    }
  }

  /**
   * Helper: Create event from payment completion
   */
  createPaymentEvent(payment: any): PaymentCompletionEvent {
    return {
      event_type: 'payments',
      record_id: null,
      user_id: payment.user_id,
      payment_id: payment.id,
      amount: payment.final_amount / 100,
      trigger_source: 'payments',
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Helper: Create event from membership completion
   */
  createMembershipEvent(membership: any): PaymentCompletionEvent {
    return {
      event_type: 'user_memberships',
      record_id: membership.id,
      user_id: membership.user_id,
      payment_id: membership.payment_id || null,
      amount: membership.amount_paid || 0,
      trigger_source: 'user_memberships',
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Helper: Create event from registration completion
   */
  createRegistrationEvent(registration: any): PaymentCompletionEvent {
    return {
      event_type: 'user_registrations',
      record_id: registration.id,
      user_id: registration.user_id,
      payment_id: registration.payment_id || null,
      amount: registration.amount_paid || 0,
      trigger_source: 'user_registrations',
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Helper: Create failed payment event
   */
  createFailedPaymentEvent(payment: any, failureReason: string): PaymentCompletionEvent {
    return {
      event_type: 'payments',
      record_id: null,
      user_id: payment.user_id,
      payment_id: payment.id,
      amount: payment.final_amount / 100,
      trigger_source: 'payments',
      timestamp: new Date().toISOString(),
      metadata: {
        failed: true,
        failure_reason: failureReason,
        payment_intent_id: payment.stripe_payment_intent_id
      }
    }
  }
}

// Export singleton instance for direct usage
// 
// Usage examples:
// 
// From Stripe webhook:
// const event = paymentProcessor.createPaymentEvent(payment)
// await paymentProcessor.processPaymentCompletion(event)
// 
// From zero-value purchase:
// const event = paymentProcessor.createMembershipEvent(membership)
// await paymentProcessor.processPaymentCompletion(event)
// 
// From failed payment:
// const event = paymentProcessor.createFailedPaymentEvent(payment, 'Card declined')
// await paymentProcessor.processPaymentCompletion(event)
// 
// Direct event creation:
// await paymentProcessor.processPaymentCompletion({
//   event_type: 'payments',
//   record_id: null,
//   user_id: 'user-id',
//   payment_id: 'payment-id',
//   amount: 50.00,
//   trigger_source: 'stripe_webhook',
//   timestamp: new Date().toISOString()
// })
// 
// Note: Email processing is now handled by the dedicated EmailProcessor class
// which is automatically called by the PaymentCompletionProcessor
export const paymentProcessor = new PaymentCompletionProcessor()