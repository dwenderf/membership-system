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

}

export const emailStagingManager = new EmailStagingManager() 