/**
 * Email Processing Manager
 * 
 * Processes staged emails by sending them directly to Loops and updating existing log records.
 * This is the ONLY place where staged emails should be processed to avoid duplicates.
 */

import { logger } from '@/lib/logging/logger'
import { createAdminClient } from '@/lib/supabase/server'
import { LoopsClient } from 'loops'

export class EmailProcessingManager {
  private loops: LoopsClient | null = null

  constructor() {
    const apiKey = process.env.LOOPS_API_KEY
    if (!apiKey || apiKey === 'your_loops_api_key') {
      console.warn('LOOPS_API_KEY not configured. Email sending will be disabled.')
      this.loops = null
    } else {
      this.loops = new LoopsClient(apiKey)
    }
  }

  /**
   * Process staged emails
   * 
   * Fetches pending email logs and sends them directly to Loops,
   * then updates the existing log records with the results.
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
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    }

    try {
      logger.logBatchProcessing(
        'email-processing-start',
        'Starting staged email processing'
      )

      const supabase = createAdminClient()
      
      // Get pending emails with configurable limit (default 100 for cron jobs)
      const limit = options.limit || 100
      const { data: pendingEmails, error } = await supabase
        .from('email_logs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit)

      if (error) {
        results.errors.push(`Failed to fetch pending emails: ${error.message}`)
        return { success: false, results, error: error.message }
      }

      if (!pendingEmails || pendingEmails.length === 0) {
        return { success: true, results }
      }

      results.processed = pendingEmails.length

      // Process each pending email with delays to prevent overwhelming the email service
      for (let i = 0; i < pendingEmails.length; i++) {
        const emailLog = pendingEmails[i]
        
        try {
          logger.logPaymentProcessing(
            'email-staged-processing',
            `Processing email ${i + 1}/${pendingEmails.length}`,
            { 
              emailLogId: emailLog.id,
              eventType: emailLog.event_type,
              progress: `${i + 1}/${pendingEmails.length}`
            }
          )
          
          const success = await this.sendStagedEmail(emailLog)
          
          if (success) {
            results.successful++
          } else {
            results.failed++
            results.errors.push(`Failed to send email ${emailLog.id}`)
          }
        } catch (emailError) {
          results.failed++
          results.errors.push(`Error processing email ${emailLog.id}: ${emailError instanceof Error ? emailError.message : String(emailError)}`)
        }
        
        // Add delay between emails to prevent overwhelming the email service
        // Skip delay for the last email
        if (i < pendingEmails.length - 1) {
          const delayMs = this.getEmailDelayMs()
          logger.logPaymentProcessing(
            'email-staged-delay',
            `Waiting ${delayMs}ms before next email`,
            { 
              delayMs,
              remainingEmails: pendingEmails.length - i - 1
            }
          )
          await this.delay(delayMs)
        }
      }

      logger.logBatchProcessing(
        'email-processing-complete',
        'Completed staged email processing',
        {
          processed: results.processed,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors,
          limit
        }
      )

      return { success: true, results }

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
   * Send a specific staged email directly to Loops and update the existing log record
   */
  private async sendStagedEmail(emailLog: any): Promise<boolean> {
    try {
      const supabase = createAdminClient()
      const emailData = emailLog.email_data || {}

      // If Loops is not configured, just mark as sent for development
      if (!this.loops) {
        console.log('📧 Email would be sent (Loops not configured):', {
          to: emailLog.email_address,
          subject: emailLog.subject,
          eventType: emailLog.event_type,
          data: emailData
        })

        // Update email log status to sent
        await supabase
          .from('email_logs')
          .update({ 
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('id', emailLog.id)

        return true
      }

      // Send email directly to Loops
      let loopsResponse
      if (emailLog.template_id) {
        // Clean data to ensure no undefined values and convert to string/number
        const cleanData: { [key: string]: string | number } = {}
        for (const [key, value] of Object.entries(emailData)) {
          if (value !== undefined && value !== null) {
            cleanData[key] = typeof value === 'number' ? value : String(value)
          }
        }
        
        loopsResponse = await this.loops!.sendTransactionalEmail({
          transactionalId: emailLog.template_id,
          email: emailLog.email_address,
          dataVariables: cleanData
        })
      } else {
        // Send as a basic contact event (for triggering automations)
        loopsResponse = await this.loops!.sendEvent({
          email: emailLog.email_address,
          eventName: emailLog.event_type,
          eventProperties: {
            subject: emailLog.subject,
            ...emailData
          }
        })
      }

      // Update log with Loops event ID if available
      if (loopsResponse && 'success' in loopsResponse && loopsResponse.success) {
        await supabase
          .from('email_logs')
          .update({
            loops_event_id: (loopsResponse as any).id || 'sent',
            status: 'delivered',
            delivered_at: new Date().toISOString()
          })
          .eq('id', emailLog.id)
        
        logger.logPaymentProcessing(
          'email-staged-sent',
          'Successfully sent staged email',
          { 
            emailLogId: emailLog.id,
            eventType: emailLog.event_type,
            userId: emailLog.user_id,
            loopsEventId: (loopsResponse as any).id
          }
        )

        return true
      } else {
        // Update email log status to failed
        await supabase
          .from('email_logs')
          .update({ 
            status: 'failed',
            bounce_reason: 'Loops API error'
          })
          .eq('id', emailLog.id)
        
        return false
      }

    } catch (error) {
      // Update email log status to failed
      try {
        const supabase = createAdminClient()
        await supabase
          .from('email_logs')
          .update({ 
            status: 'failed',
            bounce_reason: error instanceof Error ? error.message : String(error)
          })
          .eq('id', emailLog.id)
      } catch (updateError) {
        // Ignore update errors
      }

      logger.logPaymentProcessing(
        'email-staged-failed',
        'Failed to send staged email',
        { 
          emailLogId: emailLog.id,
          eventType: emailLog.event_type,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )

      return false
    }
  }

  /**
   * Get delay between emails in milliseconds
   * Configurable delay to prevent overwhelming the email service
   */
  private getEmailDelayMs(): number {
    const configDelay = process.env.LOOPS_EMAIL_BATCH_DELAY_MS
    if (configDelay) {
      const parsed = parseInt(configDelay, 10)
      if (!isNaN(parsed) && parsed >= 0) {
        return parsed
      }
    }
    return 150 // Default 150ms
  }

  /**
   * Add delay between operations
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
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