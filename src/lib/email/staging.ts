import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export interface StagedEmailData {
  user_id: string
  email_address: string
  event_type: string
  subject: string
  template_id?: string
  email_data?: Record<string, any>
  triggered_by?: 'user_action' | 'admin_send' | 'automated'
  triggered_by_user_id?: string
  related_entity_type?: 'user_memberships' | 'user_registrations' | 'payments'
  related_entity_id?: string
  payment_id?: string
}

export interface EmailStagingOptions {
  isImmediate?: boolean // If true, send immediately instead of staging
}

class EmailStagingManager {
  /**
   * Stage an email for later sending
   */
  async stageEmail(
    emailData: StagedEmailData,
    options: EmailStagingOptions = {}
  ): Promise<boolean> {
    try {
      const supabase = createAdminClient()
      
      // If immediate sending is requested, log warning and stage instead
      if (options.isImmediate) {
        logger.logPaymentProcessing(
          'email-immediate-deprecated',
          'Immediate email sending is deprecated, staging instead',
          { 
            userId: emailData.user_id,
            eventType: emailData.event_type
          },
          'warn'
        )
      }

      // Stage the email for batch processing
      const { data, error } = await supabase
        .from('email_logs')
        .insert({
          user_id: emailData.user_id,
          email_address: emailData.email_address,
          event_type: emailData.event_type,
          subject: emailData.subject,
          template_id: emailData.template_id,
          status: 'pending', // Staged status
          triggered_by: emailData.triggered_by || 'automated',
          triggered_by_user_id: emailData.triggered_by_user_id,
          // Store related entity info for context
          email_data: {
            ...emailData.email_data,
            related_entity_type: emailData.related_entity_type,
            related_entity_id: emailData.related_entity_id,
            payment_id: emailData.payment_id
          }
        })
        .select('id')
        .single()

      if (error) {
        logger.logPaymentProcessing(
          'email-staging-failed',
          'Failed to stage email',
          { 
            userId: emailData.user_id,
            eventType: emailData.event_type,
            error: error.message
          },
          'error'
        )
        return false
      }

      logger.logPaymentProcessing(
        'email-staging-success',
        'Successfully staged email for batch processing',
        { 
          userId: emailData.user_id,
          eventType: emailData.event_type,
          emailLogId: data.id
        },
        'info'
      )

      return true
    } catch (error) {
      logger.logPaymentProcessing(
        'email-staging-error',
        'Error staging email',
        { 
          userId: emailData.user_id,
          eventType: emailData.event_type,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  /**
   * Send email immediately (bypass staging)
   */
  // Removed sendEmailImmediately as it is not used anywhere in the codebase

  /**
   * Process staged emails (called by batch processor)
   */
  async processStagedEmails(): Promise<{
    processed: number
    successful: number
    failed: number
    errors: string[]
  }> {
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    }

    try {
      const supabase = createAdminClient()
      
      // Get all pending emails
      const { data: pendingEmails, error } = await supabase
        .from('email_logs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(100) // Process in batches

      if (error) {
        results.errors.push(`Failed to fetch pending emails: ${error.message}`)
        return results
      }

      if (!pendingEmails || pendingEmails.length === 0) {
        return results
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
        'email-batch-complete',
        `Processed ${results.processed} staged emails`,
        {
          processed: results.processed,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors
        }
      )

      return results
    } catch (error) {
      results.errors.push(`Batch processing error: ${error instanceof Error ? error.message : String(error)}`)
      return results
    }
  }

  /**
   * Get delay between emails in milliseconds
   * Configurable delay to prevent overwhelming the email service
   */
  private getEmailDelayMs(): number {
    // Default delay: 1 second between emails
    // Can be made configurable via environment variable
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
   * Send a specific staged email
   */
  private async sendStagedEmail(emailLog: any): Promise<boolean> {
    try {
      const { emailService } = await import('./service')
      const supabase = createAdminClient()

      // Extract related entity info from email_data
      const emailData = emailLog.email_data || {}
      const relatedEntityType = emailData.related_entity_type
      const relatedEntityId = emailData.related_entity_id
      const paymentId = emailData.payment_id

      // Send the email based on event type
      switch (emailLog.event_type) {
        case 'membership.purchased':
          await emailService.sendMembershipPurchaseConfirmation({
            userId: emailLog.user_id,
            email: emailLog.email_address,
            userName: emailData.userName || '',
            membershipName: emailData.membershipName || '',
            amount: emailData.amount || 0,
            durationMonths: emailData.durationMonths || 0,
            validFrom: emailData.validFrom || '',
            validUntil: emailData.validUntil || '',
            paymentIntentId: emailData.paymentIntentId || '',
            triggeredBy: emailLog.triggered_by || 'automated'
          })
          break

        case 'registration.completed':
          await emailService.sendRegistrationConfirmation({
            userId: emailLog.user_id,
            email: emailLog.email_address,
            userName: emailData.userName || '',
            registrationName: emailData.registrationName || '',
            categoryName: emailData.categoryName || '',
            seasonName: emailData.seasonName || '',
            amount: emailData.amount || 0,
            paymentIntentId: emailData.paymentIntentId || '',
            triggeredBy: emailLog.triggered_by || 'automated'
          })
          break

        default:
          logger.logPaymentProcessing(
            'email-staged-unknown-type',
            'Unknown email event type for staged sending',
            { 
              emailLogId: emailLog.id,
              eventType: emailLog.event_type
            },
            'warn'
          )
          return false
      }

      // Update email log status to sent
      const { error: updateError } = await supabase
        .from('email_logs')
        .update({ 
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', emailLog.id)

      if (updateError) {
        logger.logPaymentProcessing(
          'email-status-update-failed',
          'Failed to update email log status',
          { 
            emailLogId: emailLog.id,
            error: updateError.message
          },
          'error'
        )
        // Don't fail the whole operation, just log the issue
      }

      logger.logPaymentProcessing(
        'email-staged-sent',
        'Successfully sent staged email',
        { 
          emailLogId: emailLog.id,
          eventType: emailLog.event_type,
          userId: emailLog.user_id
        },
        'info'
      )

      return true
    } catch (error) {
      // Update email log status to failed
      try {
        const supabase = createAdminClient()
        await supabase
          .from('email_logs')
          .update({ 
            status: 'bounced',
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
}

export const emailStagingManager = new EmailStagingManager() 