import { createClient } from '@/lib/supabase/server'
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
      const supabase = await createClient()
      
      // If immediate sending is requested, send directly
      if (options.isImmediate) {
        return await this.sendEmailImmediately(emailData)
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
  private async sendEmailImmediately(emailData: StagedEmailData): Promise<boolean> {
    try {
      const { emailService } = await import('./email-service')
      
      // Map event types to email service methods
      switch (emailData.event_type) {
        case 'membership.purchased':
          await emailService.sendMembershipPurchaseConfirmation({
            userId: emailData.user_id,
            email: emailData.email_address,
            userName: emailData.email_data?.userName || '',
            membershipName: emailData.email_data?.membershipName || '',
            amount: emailData.email_data?.amount || 0,
            durationMonths: emailData.email_data?.durationMonths || 0,
            validFrom: emailData.email_data?.validFrom || '',
            validUntil: emailData.email_data?.validUntil || '',
            paymentIntentId: emailData.email_data?.paymentIntentId || ''
          })
          break

        case 'registration.completed':
          await emailService.sendRegistrationConfirmation({
            userId: emailData.user_id,
            email: emailData.email_address,
            userName: emailData.email_data?.userName || '',
            registrationName: emailData.email_data?.registrationName || '',
            categoryName: emailData.email_data?.categoryName || '',
            seasonName: emailData.email_data?.seasonName || '',
            amount: emailData.email_data?.amount || 0,
            paymentIntentId: emailData.email_data?.paymentIntentId || ''
          })
          break

        default:
          logger.logPaymentProcessing(
            'email-immediate-unknown-type',
            'Unknown email event type for immediate sending',
            { 
              userId: emailData.user_id,
              eventType: emailData.event_type
            },
            'warn'
          )
          return false
      }

      logger.logPaymentProcessing(
        'email-immediate-success',
        'Successfully sent email immediately',
        { 
          userId: emailData.user_id,
          eventType: emailData.event_type
        },
        'info'
      )

      return true
    } catch (error) {
      logger.logPaymentProcessing(
        'email-immediate-error',
        'Error sending email immediately',
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
      const supabase = await createClient()
      
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

      // Process each pending email
      for (const emailLog of pendingEmails) {
        try {
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
   * Send a specific staged email
   */
  private async sendStagedEmail(emailLog: any): Promise<boolean> {
    try {
      const { emailService } = await import('./email-service')
      const supabase = await createClient()

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
            paymentIntentId: emailData.paymentIntentId || ''
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
            paymentIntentId: emailData.paymentIntentId || ''
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
        const supabase = await createClient()
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