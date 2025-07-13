/**
 * Scheduled Batch Processing Service
 * 
 * Handles automatic background processing of pending operations
 * with configurable intervals and priority handling.
 */

import { batchProcessor } from './batch-processor'
import { xeroBatchSyncManager } from './xero-batch-sync'
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
      // Check if there are any pending records before processing
      const pendingCount = await this.getPendingXeroCount()
      
      if (pendingCount === 0) {
        logger.logXeroSync(
          'scheduled-sync-skip',
          'No pending Xero records to sync',
          { pendingCount: 0 }
        )
        return
      }

      logger.logXeroSync(
        'scheduled-sync-start',
        `Found ${pendingCount} pending Xero records, starting sync`,
        { pendingCount }
      )

      // Run the batch sync
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
   * Get count of pending Xero records
   */
  private async getPendingXeroCount(): Promise<number> {
    try {
      const { count: invoiceCount } = await this.supabase
        .from('xero_invoices')
        .select('*', { count: 'exact', head: true })
        .in('sync_status', ['pending', 'staged'])

      const { count: paymentCount } = await this.supabase
        .from('xero_payments')
        .select('*', { count: 'exact', head: true })
        .in('sync_status', ['pending', 'staged'])

      return (invoiceCount || 0) + (paymentCount || 0)
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