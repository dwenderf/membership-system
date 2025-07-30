/**
 * Email Processing Manager
 * 
 * Simple email processing utility that processes staged emails directly.
 * No complex batch job system needed - just fetch and send emails with delays.
 */

import { logger } from '@/lib/logging/logger'
import { emailStagingManager } from './staging'

export class EmailProcessingManager {
  /**
   * Process staged emails
   * 
   * Simple method that processes pending staged emails with delays.
   * No complex batch job system needed.
   */
  async processStagedEmails(options: { limit?: number } = {}): Promise<{
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
        'email-processing-start',
        'Starting staged email processing'
      )

      const results = await emailStagingManager.processStagedEmails(options)

      logger.logBatchProcessing(
        'email-processing-complete',
        'Completed staged email processing',
        {
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
        'email-processing-failed',
        'Staged email processing failed',
        { error: errorMessage }
      )

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Get processing status
   */
  getStatus() {
    return {
      type: 'email_processing'
    }
  }
}

// Export singleton instance
export const emailProcessingManager = new EmailProcessingManager() 