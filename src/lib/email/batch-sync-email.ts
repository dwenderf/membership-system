/**
 * Email Batch Sync Manager
 * 
 * Dedicated batch sync manager for email operations, following the same pattern
 * as the Xero batch sync manager for consistency.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { emailStagingManager } from './staging'

export interface EmailBatchJob {
  id: string
  type: 'email_batch'
  priority: 'high' | 'medium' | 'low'
  payload: {
    batchSize?: number
    delayMs?: number
  }
  retry_count: number
  max_retries: number
  next_retry_at?: Date
  created_at: Date
  updated_at: Date
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
}

export class EmailBatchSyncManager {
  private supabase: ReturnType<typeof createAdminClient>
  private isProcessing = false
  private processingInterval?: NodeJS.Timeout

  constructor() {
    this.supabase = createAdminClient()
  }

  /**
   * Process email batch sync jobs
   */
  async processEmailBatch(job: EmailBatchJob): Promise<{
    success: boolean
    results?: {
      processed: number
      successful: number
      failed: number
      errors: string[]
    }
    error?: string
  }> {
    try {
      logger.logBatchProcessing(
        'email-batch-sync-start',
        `Starting email batch sync job ${job.id}`,
        { jobId: job.id, payload: job.payload }
      )

      const results = await emailStagingManager.processStagedEmails()

      logger.logBatchProcessing(
        'email-batch-sync-complete',
        `Completed email batch sync job ${job.id}`,
        {
          jobId: job.id,
          processed: results.processed,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors
        }
      )

      return {
        success: true,
        results
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.logBatchProcessing(
        'email-batch-sync-failed',
        `Email batch sync job ${job.id} failed`,
        {
          jobId: job.id,
          error: errorMessage
        }
      )

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Start scheduled email batch sync processing
   */
  async startScheduledProcessing(intervalMs: number = 60000): Promise<void> {
    if (this.isProcessing) {
      console.log('📧 Email batch processing already running')
      return
    }

    console.log(`⏰ Starting scheduled email batch processing every ${intervalMs}ms`)
    this.isProcessing = true

    this.processingInterval = setInterval(async () => {
      try {
        await this.processScheduledBatches()
      } catch (error) {
        console.error('❌ Error in scheduled email batch processing:', error)
      }
    }, intervalMs)
  }

  /**
   * Stop scheduled email batch sync processing
   */
  async stopScheduledProcessing(): Promise<void> {
    if (!this.isProcessing) {
      console.log('📧 Email batch processing not running')
      return
    }

    console.log('🛑 Stopping scheduled email batch processing')
    this.isProcessing = false

    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = undefined
    }
  }

  /**
   * Process scheduled email batch sync operations
   */
  private async processScheduledBatches(): Promise<void> {
    console.log('📧 Running scheduled email batch sync processing...')
    
    try {
      const results = await emailStagingManager.processStagedEmails()
      
              console.log('📧 Email batch sync results:', {
        processed: results.processed,
        successful: results.successful,
        failed: results.failed,
        errors: results.errors
      })
      
              console.log('✅ Scheduled email batch sync completed')
    } catch (error) {
              console.error('❌ Scheduled email batch sync failed:', error)
    }
  }

  /**
   * Get processing status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      hasInterval: !!this.processingInterval,
      type: 'email_batch'
    }
  }

  /**
   * Create a new email batch sync job
   */
  async createBatchJob(options: {
    batchSize?: number
    delayMs?: number
    priority?: 'high' | 'medium' | 'low'
  } = {}): Promise<string> {
    const job: EmailBatchJob = {
      id: `email_batch_${Date.now()}`,
      type: 'email_batch',
      priority: options.priority || 'medium',
      payload: {
        batchSize: options.batchSize || 100,
        delayMs: options.delayMs || 150
      },
      retry_count: 0,
      max_retries: 3,
      created_at: new Date(),
      updated_at: new Date(),
      status: 'pending'
    }

    // For now, we'll just log the job creation
    // In the future, this could be stored in a batch_jobs table
          logger.logBatchProcessing(
        'email-batch-sync-job-created',
        `Created email batch sync job ${job.id}`,
        { jobId: job.id, payload: job.payload }
      )

    return job.id
  }

  /**
   * Process a specific batch sync job by ID
   */
  async processBatchJob(jobId: string): Promise<{
    success: boolean
    results?: any
    error?: string
  }> {
    // For now, we'll create a mock job and process it
    // In the future, this would fetch the job from the database
    const mockJob: EmailBatchJob = {
      id: jobId,
      type: 'email_batch',
      priority: 'medium',
      payload: {
        batchSize: 100,
        delayMs: 150
      },
      retry_count: 0,
      max_retries: 3,
      created_at: new Date(),
      updated_at: new Date(),
      status: 'processing'
    }

    return this.processEmailBatch(mockJob)
  }
}

// Export singleton instance
export const emailBatchSyncManager = new EmailBatchSyncManager() 