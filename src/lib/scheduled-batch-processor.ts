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
      console.log('📋 Scheduled batch processing already running')
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

    console.log('✅ All scheduled processors started')
  }

  /**
   * Stop all scheduled batch processors
   */
  async stopScheduledProcessing(): Promise<void> {
    if (!this.isRunning) {
      console.log('📋 Scheduled batch processing not running')
      return
    }

    console.log('🛑 Stopping scheduled batch processing')
    this.isRunning = false

    // Clear all intervals
    for (const [name, interval] of this.intervals) {
      clearInterval(interval)
      console.log(`🛑 Stopped ${name} processor`)
    }
    this.intervals.clear()

    console.log('✅ All scheduled processors stopped')
  }

  /**
   * Start Xero sync processor
   */
  private startXeroSyncProcessor(): void {
    const interval = setInterval(async () => {
      try {
        await this.processXeroSync()
      } catch (error) {
        console.error('❌ Error in scheduled Xero sync:', error)
      }
    }, this.schedule.xeroSync.intervalMs)

    this.intervals.set('xero-sync', interval)
    console.log('📊 Started Xero sync processor')
  }

  /**
   * Start email retry processor
   */
  private startEmailRetryProcessor(): void {
    const interval = setInterval(async () => {
      try {
        await this.processEmailRetries()
      } catch (error) {
        console.error('❌ Error in scheduled email retry:', error)
      }
    }, this.schedule.emailRetry.intervalMs)

    this.intervals.set('email-retry', interval)
    console.log('📧 Started email retry processor')
  }

  /**
   * Start cleanup processor
   */
  private startCleanupProcessor(): void {
    const interval = setInterval(async () => {
      try {
        await this.processCleanup()
      } catch (error) {
        console.error('❌ Error in scheduled cleanup:', error)
      }
    }, this.schedule.cleanup.intervalMs)

    this.intervals.set('cleanup', interval)
    console.log('🧹 Started cleanup processor')
  }

  /**
   * Process pending Xero syncs
   */
  private async processXeroSync(): Promise<void> {
    console.log('🔄 Running scheduled Xero sync...')

    try {
      // Check if there are any pending records before processing
      const pendingCount = await this.getPendingXeroCount()
      
      if (pendingCount === 0) {
        console.log('📋 No pending Xero records to sync')
        return
      }

      logger.logXeroSync(
        'scheduled-sync-start',
        `Found ${pendingCount} pending Xero records, starting sync`,
        { pendingCount }
      )

      // Run the batch sync
      const results = await xeroBatchSyncManager.syncAllPendingRecords()
      
      console.log('📈 Scheduled Xero sync results:', {
        invoices: `${results.invoices.synced} synced, ${results.invoices.failed} failed`,
        payments: `${results.payments.synced} synced, ${results.payments.failed} failed`
      })

      // Log metrics for monitoring using batch processor
      await batchProcessor.logProcessingMetrics('xero_sync', {
        totalItems: results.invoices.synced + results.invoices.failed + results.payments.synced + results.payments.failed,
        successCount: results.invoices.synced + results.payments.synced,
        failureCount: results.invoices.failed + results.payments.failed,
        processingTimeMs: 0, // Would need to track this in xeroBatchSyncManager
        averageItemTimeMs: 0
      })

    } catch (error) {
      console.error('❌ Error in scheduled Xero sync:', error)
      await this.logProcessingMetrics('xero_sync', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Process email retries
   */
  private async processEmailRetries(): Promise<void> {
    console.log('🔄 Running scheduled email retries...')

    try {
      // TODO: Implement email retry logic
      // This would:
      // 1. Query email_logs for failed emails
      // 2. Retry emails that haven't exceeded max retry count
      // 3. Use intelligent backoff for retries
      
      console.log('🚧 Email retry processing - to be implemented')
      
      await this.logProcessingMetrics('email_retry', { processed: 0 })

    } catch (error) {
      console.error('❌ Error in scheduled email retries:', error)
      await this.logProcessingMetrics('email_retry', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Process cleanup tasks
   */
  private async processCleanup(): Promise<void> {
    console.log('🔄 Running scheduled cleanup...')

    try {
      let totalCleaned = 0

      // Clean up old staging records that are successfully synced
      const cleanupResults = await this.cleanupOldStagingRecords()
      totalCleaned += cleanupResults.cleaned

      // Clean up old log entries
      const logCleanupResults = await this.cleanupOldLogEntries()
      totalCleaned += logCleanupResults.cleaned

      console.log(`🧹 Cleanup completed: ${totalCleaned} records cleaned`)
      
      await this.logProcessingMetrics('cleanup', {
        staging_records_cleaned: cleanupResults.cleaned,
        log_entries_cleaned: logCleanupResults.cleaned,
        total_cleaned: totalCleaned
      })

    } catch (error) {
      console.error('❌ Error in scheduled cleanup:', error)
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
      console.error('❌ Error getting pending Xero count:', error)
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
        console.log(`🧹 Cleaned up ${totalCleaned} old staging records`)
      }

      return { cleaned: totalCleaned }
    } catch (error) {
      console.error('❌ Error cleaning up staging records:', error)
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
        console.log(`🧹 Cleaned up ${logsDeleted} old log entries`)
      }

      return { cleaned: logsDeleted || 0 }
    } catch (error) {
      console.error('❌ Error cleaning up log entries:', error)
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
      // This could be enhanced to write to a metrics table or external monitoring service
      console.log(`📊 Processing metrics [${operation}]:`, metrics)
      
      // TODO: Implement metrics logging to database or external service
      // For now, just console logging for debugging
      
    } catch (error) {
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
    console.log('📋 Updated processing schedule:', this.schedule)
  }
}

// Export singleton instance
export const scheduledBatchProcessor = new ScheduledBatchProcessor()