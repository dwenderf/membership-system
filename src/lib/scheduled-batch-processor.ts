/**
 * Scheduled Batch Processing Service
 * 
 * Handles automatic background processing of pending operations
 * with configurable intervals and priority handling.
 */

import { batchProcessor } from './batch-processor'
import { xeroBatchSyncManager } from './xero/batch-sync'
import { xeroStagingManager } from './xero/staging'
import { createAdminClient } from './supabase/server'
import { Database } from '@/types/database'
import { logger } from './logging/logger'

export interface ProcessingSchedule {
  xeroSync: {
    enabled: boolean
    intervalMs: number
    maxItemsPerRun: number
  }
  emailRetry: {
    enabled: boolean
    intervalMs: number
    maxItemsPerRun: number
  }
  cleanup: {
    enabled: boolean
    intervalMs: number
    maxItemsPerRun: number
  }
}

export class ScheduledBatchProcessor {
  private supabase: ReturnType<typeof createAdminClient>
  private isRunning = false
  private intervals: Map<string, NodeJS.Timeout> = new Map()

  // Default processing schedule
  private schedule: ProcessingSchedule = {
    xeroSync: {
      enabled: true,
      intervalMs: 2 * 60 * 1000,    // Every 2 minutes
      maxItemsPerRun: 50
    },
    emailRetry: {
      enabled: true,
      intervalMs: 5 * 60 * 1000,    // Every 5 minutes
      maxItemsPerRun: 100
    },
    cleanup: {
      enabled: true,
      intervalMs: 60 * 60 * 1000,   // Every hour
      maxItemsPerRun: 500
    }
  }

  constructor() {
    this.supabase = createAdminClient()
  }

  /**
   * Start all scheduled batch processors
   */
  async startScheduledProcessing(customSchedule?: Partial<ProcessingSchedule>): Promise<void> {
    if (this.isRunning) {
      logger.logBatchProcessing(
        'scheduled-already-running',
        'Scheduled batch processing already running',
        {},
        'warn'
      )
      return
    }

    // Merge custom schedule with defaults
    if (customSchedule) {
      this.schedule = { ...this.schedule, ...customSchedule }
    }

    logger.logBatchProcessing(
      'scheduled-start',
      'Starting scheduled batch processing',
      {
        xeroSync: `${this.schedule.xeroSync.intervalMs}ms`,
        emailRetry: `${this.schedule.emailRetry.intervalMs}ms`,
        cleanup: `${this.schedule.cleanup.intervalMs}ms`
      }
    )

    this.isRunning = true

    // Start Xero sync processor
    if (this.schedule.xeroSync.enabled) {
      this.startXeroSyncProcessor()
    }

    // Start email retry processor
    if (this.schedule.emailRetry.enabled) {
      this.startEmailRetryProcessor()
    }

    // Start cleanup processor
    if (this.schedule.cleanup.enabled) {
      this.startCleanupProcessor()
    }

    logger.logBatchProcessing(
      'all-processors-started',
      'All scheduled processors started',
      { processorsEnabled: Object.keys(this.schedule).filter(key => this.schedule[key as keyof ProcessingSchedule].enabled) }
    )
  }

  /**
   * Stop all scheduled batch processors
   */
  async stopScheduledProcessing(): Promise<void> {
    if (!this.isRunning) {
      logger.logBatchProcessing(
        'not-running',
        'Scheduled batch processing not running',
        {},
        'warn'
      )
      return
    }

    logger.logBatchProcessing(
      'stopping-processors',
      'Stopping scheduled batch processing',
      { activeProcessors: Array.from(this.intervals.keys()) }
    )
    this.isRunning = false

    // Clear all intervals
    for (const [name, interval] of this.intervals) {
      clearInterval(interval)
      logger.logBatchProcessing(
        'processor-stopped',
        `Stopped ${name} processor`,
        { processorName: name }
      )
    }
    this.intervals.clear()

    logger.logBatchProcessing(
      'all-processors-stopped',
      'All scheduled processors stopped',
      { stoppedCount: this.intervals.size }
    )
  }

  /**
   * Start Xero sync processor
   */
  private startXeroSyncProcessor(): void {
    const interval = setInterval(async () => {
      try {
        await this.processXeroSync()
      } catch (error) {
        logger.logXeroSync(
          'scheduled-sync-error',
          'Error in scheduled Xero sync',
          { error: error instanceof Error ? error.message : String(error) },
          'error'
        )
      }
    }, this.schedule.xeroSync.intervalMs)

    this.intervals.set('xero-sync', interval)
    logger.logBatchProcessing(
      'xero-processor-started',
      'Started Xero sync processor',
      { intervalMs: this.schedule.xeroSync.intervalMs }
    )
  }

  /**
   * Start email retry processor
   */
  private startEmailRetryProcessor(): void {
    const interval = setInterval(async () => {
      try {
        await this.processEmailRetries()
      } catch (error) {
        logger.logBatchProcessing(
          'email-retry-error',
          'Error in scheduled email retry',
          { error: error instanceof Error ? error.message : String(error) },
          'error'
        )
      }
    }, this.schedule.emailRetry.intervalMs)

    this.intervals.set('email-retry', interval)
    logger.logBatchProcessing(
      'email-processor-started',
      'Started email retry processor',
      { intervalMs: this.schedule.emailRetry.intervalMs }
    )
  }

  /**
   * Start cleanup processor
   */
  private startCleanupProcessor(): void {
    const interval = setInterval(async () => {
      try {
        await this.processCleanup()
      } catch (error) {
        logger.logBatchProcessing(
          'cleanup-error',
          'Error in scheduled cleanup',
          { error: error instanceof Error ? error.message : String(error) },
          'error'
        )
      }
    }, this.schedule.cleanup.intervalMs)

    this.intervals.set('cleanup', interval)
    logger.logBatchProcessing(
      'cleanup-processor-started',
      'Started cleanup processor',
      { intervalMs: this.schedule.cleanup.intervalMs }
    )
  }

  /**
   * Process pending Xero syncs
   */
  private async processXeroSync(): Promise<void> {
    logger.logXeroSync(
      'scheduled-sync-start',
      'Running scheduled Xero sync',
      { processor: 'scheduled' }
    )

    try {
      // Step 1: Create staging records for completed payments that don't have them
      // DISABLED: With staging-first approach, all payments should already have staging records
      // const stagingCreated = await this.createMissingStagingRecords()
      const stagingCreated = 0

      // Step 2: Check if there are any pending records to sync
      const pendingCount = await this.getPendingXeroCount()
      
      if (pendingCount === 0 && stagingCreated === 0) {
        logger.logXeroSync(
          'scheduled-sync-skip',
          'No pending Xero records to sync and no new staging records created',
          { pendingCount: 0, stagingCreated: 0 }
        )
        return
      }

      logger.logXeroSync(
        'scheduled-sync-processing',
        `Processing Xero sync: ${stagingCreated} staging records created, ${pendingCount} pending records to sync`,
        { pendingCount, stagingCreated }
      )

      // Step 3: Run the batch sync
      const results = await xeroBatchSyncManager.syncAllPendingRecords()
      
      logger.logXeroSync(
        'scheduled-sync-results',
        'Scheduled Xero sync completed',
        {
          invoices: { synced: results.invoices.synced, failed: results.invoices.failed },
          payments: { synced: results.payments.synced, failed: results.payments.failed },
          totalSynced: results.invoices.synced + results.payments.synced,
          totalFailed: results.invoices.failed + results.payments.failed
        }
      )

      // Log metrics for monitoring using batch processor
      await batchProcessor.logProcessingMetrics('xero_sync', {
        totalItems: results.invoices.synced + results.invoices.failed + results.payments.synced + results.payments.failed,
        successCount: results.invoices.synced + results.payments.synced,
        failureCount: results.invoices.failed + results.payments.failed,
        processingTimeMs: 0, // Would need to track this in xeroBatchSyncManager
        averageItemTimeMs: 0
      })

    } catch (error) {
      logger.logXeroSync(
        'scheduled-sync-outer-error',
        'Error in scheduled Xero sync',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      await this.logProcessingMetrics('xero_sync', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Process email retries
   */
  private async processEmailRetries(): Promise<void> {
    logger.logBatchProcessing(
      'scheduled-email-retry',
      'Running scheduled email retries',
      { processor: 'scheduled' }
    )

    try {
      // TODO: Implement email retry logic
      // This would:
      // 1. Query email_logs for failed emails
      // 2. Retry emails that haven't exceeded max retry count
      // 3. Use intelligent backoff for retries
      
      logger.logBatchProcessing(
        'email-retry-placeholder',
        'Email retry processing - to be implemented',
        { status: 'placeholder' },
        'warn'
      )
      
      await this.logProcessingMetrics('email_retry', { processed: 0 })

    } catch (error) {
      logger.logBatchProcessing(
        'email-retry-outer-error',
        'Error in scheduled email retries',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      await this.logProcessingMetrics('email_retry', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Process cleanup tasks
   */
  private async processCleanup(): Promise<void> {
    logger.logBatchProcessing(
      'scheduled-cleanup',
      'Running scheduled cleanup',
      { processor: 'scheduled' }
    )

    try {
      let totalCleaned = 0

      // Clean up old staging records that are successfully synced
      const cleanupResults = await this.cleanupOldStagingRecords()
      totalCleaned += cleanupResults.cleaned

      // Clean up old log entries
      const logCleanupResults = await this.cleanupOldLogEntries()
      totalCleaned += logCleanupResults.cleaned

      logger.logBatchProcessing(
        'cleanup-complete',
        `Cleanup completed: ${totalCleaned} records cleaned`,
        { 
          totalCleaned,
          stagingRecordsCleaned: cleanupResults.cleaned,
          logEntriesCleaned: logCleanupResults.cleaned
        }
      )
      
      await this.logProcessingMetrics('cleanup', {
        staging_records_cleaned: cleanupResults.cleaned,
        log_entries_cleaned: logCleanupResults.cleaned,
        total_cleaned: totalCleaned
      })

    } catch (error) {
      logger.logBatchProcessing(
        'cleanup-outer-error',
        'Error in scheduled cleanup',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      await this.logProcessingMetrics('cleanup', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Get count of pending Xero records using centralized function
   */
  private async getPendingXeroCount(): Promise<number> {
    try {
      const { xeroBatchSyncManager } = await import('@/lib/xero/batch-sync')
      return await xeroBatchSyncManager.getPendingXeroCount()
    } catch (error) {
      logger.logXeroSync(
        'pending-count-error',
        'Error getting pending Xero count',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      return 0
    }
  }

  /**
   * Create staging records for completed payments that don't have them
   * 
   * DISABLED: This function is no longer needed with the staging-first approach.
   * With synchronous staging creation during purchase, all payments should already 
   * have staging records. This function should only be used for manual admin recovery
   * in exceptional circumstances, not as part of scheduled processing.
   */
  private async createMissingStagingRecords(): Promise<number> {
    try {
      logger.logXeroSync(
        'staging-creation-start',
        'Checking for completed payments without staging records',
        { processor: 'scheduled' }
      )

      let totalCreated = 0

      // Find completed payments without staging records
      // First get all payment IDs that already have staging records
      const { data: existingStagingPayments } = await this.supabase
        .from('xero_invoices')
        .select('payment_id')
        .not('payment_id', 'is', null)

      const existingPaymentIds = existingStagingPayments?.map(record => record.payment_id) || []

      // Then find completed payments not in that list
      const query = this.supabase
        .from('payments')
        .select('id, user_id, final_amount, completed_at')
        .eq('status', 'completed')

      // Only add the filter if there are existing payment IDs
      const { data: paymentsWithoutStaging, error: paymentError } = existingPaymentIds.length > 0
        ? await query.not('id', 'in', `(${existingPaymentIds.map(id => `'${id}'`).join(',')})`)
        : await query

      if (paymentError) {
        logger.logXeroSync(
          'staging-query-error',
          'Error querying payments without staging',
          { error: paymentError.message },
          'error'
        )
        return 0
      }

      if (paymentsWithoutStaging && paymentsWithoutStaging.length > 0) {
        logger.logXeroSync(
          'staging-payments-found',
          `Found ${paymentsWithoutStaging.length} completed payments without staging records`,
          { count: paymentsWithoutStaging.length }
        )

        for (const payment of paymentsWithoutStaging) {
          try {
            const success = await xeroStagingManager.createPaidPurchaseStaging(payment.id)
            if (success) {
              totalCreated++
              logger.logXeroSync(
                'staging-payment-created',
                `Created staging records for payment ${payment.id}`,
                { paymentId: payment.id, amount: payment.final_amount }
              )
            }
          } catch (error) {
            logger.logXeroSync(
              'staging-payment-error',
              `Failed to create staging for payment ${payment.id}`,
              { 
                paymentId: payment.id, 
                error: error instanceof Error ? error.message : String(error) 
              },
              'error'
            )
          }
        }
      }

      // Find free memberships without staging records
      // First get all user IDs that already have staging records for free memberships
      const { data: existingFreeMembershipStaging } = await this.supabase
        .from('xero_invoices')
        .select('user_id')
        .not('user_id', 'is', null)
        .is('payment_id', null)

      const existingFreeMembershipUserIds = existingFreeMembershipStaging?.map(record => record.user_id) || []

      // Then find free memberships not in that list
      const membershipQuery = this.supabase
        .from('user_memberships')
        .select('id, user_id, amount_paid')
        .eq('payment_status', 'paid')
        .eq('amount_paid', 0)

      const { data: freeMemberships, error: membershipError } = existingFreeMembershipUserIds.length > 0
        ? await membershipQuery.not('user_id', 'in', `(${existingFreeMembershipUserIds.map(id => `'${id}'`).join(',')})`)
        : await membershipQuery

      if (!membershipError && freeMemberships && freeMemberships.length > 0) {
        logger.logXeroSync(
          'staging-free-memberships-found',
          `Found ${freeMemberships.length} free memberships without staging records`,
          { count: freeMemberships.length }
        )

        for (const membership of freeMemberships) {
          try {
            const success = await xeroStagingManager.createFreePurchaseStaging({
              user_id: membership.user_id,
              record_id: membership.id,
              trigger_source: 'user_memberships'
            })
            if (success) {
              totalCreated++
              logger.logXeroSync(
                'staging-free-membership-created',
                `Created staging records for free membership ${membership.id}`,
                { membershipId: membership.id, userId: membership.user_id }
              )
            }
          } catch (error) {
            logger.logXeroSync(
              'staging-free-membership-error',
              `Failed to create staging for free membership ${membership.id}`,
              { 
                membershipId: membership.id, 
                error: error instanceof Error ? error.message : String(error) 
              },
              'error'
            )
          }
        }
      }

      // Find free registrations without staging records
      // We can reuse the same existingFreeMembershipUserIds list since the logic is the same
      const registrationQuery = this.supabase
        .from('user_registrations')
        .select('id, user_id, amount_paid')
        .eq('payment_status', 'paid')
        .eq('amount_paid', 0)

      const { data: freeRegistrations, error: registrationError } = existingFreeMembershipUserIds.length > 0
        ? await registrationQuery.not('user_id', 'in', `(${existingFreeMembershipUserIds.map(id => `'${id}'`).join(',')})`)
        : await registrationQuery

      if (!registrationError && freeRegistrations && freeRegistrations.length > 0) {
        logger.logXeroSync(
          'staging-free-registrations-found',
          `Found ${freeRegistrations.length} free registrations without staging records`,
          { count: freeRegistrations.length }
        )

        for (const registration of freeRegistrations) {
          try {
            const success = await xeroStagingManager.createFreePurchaseStaging({
              user_id: registration.user_id,
              record_id: registration.id,
              trigger_source: 'user_registrations'
            })
            if (success) {
              totalCreated++
              logger.logXeroSync(
                'staging-free-registration-created',
                `Created staging records for free registration ${registration.id}`,
                { registrationId: registration.id, userId: registration.user_id }
              )
            }
          } catch (error) {
            logger.logXeroSync(
              'staging-free-registration-error',
              `Failed to create staging for free registration ${registration.id}`,
              { 
                registrationId: registration.id, 
                error: error instanceof Error ? error.message : String(error) 
              },
              'error'
            )
          }
        }
      }

      if (totalCreated > 0) {
        logger.logXeroSync(
          'staging-creation-complete',
          `Created ${totalCreated} staging records for completed transactions`,
          { totalCreated }
        )
      } else {
        logger.logXeroSync(
          'staging-creation-none',
          'No new staging records needed - all completed transactions already have staging records',
          { totalCreated: 0 }
        )
      }

      return totalCreated

    } catch (error) {
      logger.logXeroSync(
        'staging-creation-error',
        'Error creating missing staging records',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      return 0
    }
  }

  /**
   * Clean up old staging records
   */
  private async cleanupOldStagingRecords(): Promise<{ cleaned: number }> {
    try {
      // Clean up staging records older than 7 days that are successfully synced
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const { count: invoicesDeleted } = await this.supabase
        .from('xero_invoices')
        .delete({ count: 'exact' })
        .eq('sync_status', 'synced')
        .lt('last_synced_at', cutoffDate)

      const { count: paymentsDeleted } = await this.supabase
        .from('xero_payments')
        .delete({ count: 'exact' })
        .eq('sync_status', 'synced')
        .lt('last_synced_at', cutoffDate)

      const totalCleaned = (invoicesDeleted || 0) + (paymentsDeleted || 0)
      
      if (totalCleaned > 0) {
        logger.logBatchProcessing(
          'cleanup-staging-records',
          `Cleaned up ${totalCleaned} old staging records`,
          { recordsCleaned: totalCleaned }
        )
      }

      return { cleaned: totalCleaned }
    } catch (error) {
      logger.logBatchProcessing(
        'staging-cleanup-error',
        'Error cleaning up staging records',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      return { cleaned: 0 }
    }
  }

  /**
   * Clean up old log entries
   */
  private async cleanupOldLogEntries(): Promise<{ cleaned: number }> {
    try {
      // Clean up log entries older than 30 days
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

      const { count: logsDeleted } = await this.supabase
        .from('xero_sync_logs')
        .delete({ count: 'exact' })
        .lt('created_at', cutoffDate)

      if (logsDeleted && logsDeleted > 0) {
        logger.logBatchProcessing(
          'cleanup-log-entries',
          `Cleaned up ${logsDeleted} old log entries`,
          { logEntriesCleaned: logsDeleted }
        )
      }

      return { cleaned: logsDeleted || 0 }
    } catch (error) {
      logger.logBatchProcessing(
        'log-cleanup-error',
        'Error cleaning up log entries',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      return { cleaned: 0 }
    }
  }

  /**
   * Log processing metrics for monitoring
   */
  private async logProcessingMetrics(
    operation: string, 
    metrics: Record<string, any>
  ): Promise<void> {
    try {
      // Log processing metrics using structured logging
      logger.logBatchProcessing(
        'processing-metrics',
        `Processing metrics for ${operation}`,
        { operation, metrics }
      )
      
      // TODO: Implement metrics logging to database or external service
      
    } catch (error) {
      // Avoid circular logging - use console for logger errors
      console.error('❌ Error logging processing metrics:', error)
    }
  }

  /**
   * Get processing status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeProcessors: Array.from(this.intervals.keys()),
      schedule: this.schedule
    }
  }

  /**
   * Update processing schedule
   */
  updateSchedule(newSchedule: Partial<ProcessingSchedule>): void {
    this.schedule = { ...this.schedule, ...newSchedule }
    logger.logBatchProcessing(
      'schedule-updated',
      'Updated processing schedule',
      { newSchedule: this.schedule }
    )
  }
}

// Export singleton instance
export const scheduledBatchProcessor = new ScheduledBatchProcessor()