/**
 * Email Processor
 * 
 * Handles all email-related operations for the payment completion flow:
 * - Staging confirmation emails for membership and registration purchases
 * - Processing staged emails immediately
 * - Sending failed payment notifications
 * 
 * This class is responsible for ensuring emails are sent exactly once:
 * - Zero-dollar purchases: Send immediately (free_membership, free_registration)
 * - Paid purchases: Send when payment completes (stripe_webhook_membership, stripe_webhook_registration)
 * - Failed payments: Send failure notification email
 */

import { emailStagingManager } from '@/lib/email/staging'
import { Logger } from '@/lib/logging/logger'
import { centsToDollars } from '@/types/currency'
import { toNYDateString } from '@/lib/date-utils'

export type PaymentCompletionEvent = {
  event_type: 'payments' | 'user_memberships' | 'user_registrations' | 'alternate_selections'
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

export class EmailProcessor {
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
      const { createAdminClient } = await import('../supabase/server')
      this.supabase = createAdminClient()
    }
  }

  /**
   * Stage confirmation emails for payment completion events
   * 
   * This method stages emails for batch processing:
   * - For zero-dollar purchases: Stage immediately (free_membership, free_registration)
   * - For paid purchases: Stage when payment completes (stripe_webhook_membership, stripe_webhook_registration)
   * 
   * The payment completion processor is the ONLY place where membership and registration
   * confirmation emails should be staged, ensuring no duplicates.
   */
  async stageConfirmationEmails(event: PaymentCompletionEvent) {
    this.logger.logPaymentProcessing('process-confirmation-emails', '📧 Processing confirmation emails...', { 
      triggerSource: event.trigger_source,
      userId: event.user_id,
      recordId: event.record_id,
      amount: event.amount
    })
    
    try {
      await this.initialize()
      
      // Get user details
      const { data: user } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', event.user_id)
        .single()

      if (!user) {
        this.logger.logPaymentProcessing('process-confirmation-emails', '❌ User not found for email', { userId: event.user_id })
        return
      }

      this.logger.logPaymentProcessing('process-confirmation-emails', '✅ User found, checking trigger source', { 
        triggerSource: event.trigger_source,
        userEmail: user.email,
        amount: event.amount
      })

      // Handle membership emails
      if (event.trigger_source === 'user_memberships' || event.trigger_source === 'stripe_webhook_membership' || event.trigger_source === 'free_membership') {
        this.logger.logPaymentProcessing('process-confirmation-emails', '📧 Triggering membership email staging', { 
          triggerSource: event.trigger_source,
          amount: event.amount,
          isFree: event.amount === 0
        })
        await this.stageMembershipConfirmationEmail(event, user)
      } 
      // Handle registration emails
      else if (event.trigger_source === 'user_registrations' || event.trigger_source === 'stripe_webhook_registration' || event.trigger_source === 'free_registration') {
        this.logger.logPaymentProcessing('process-confirmation-emails', '📧 Triggering registration email staging', { 
          triggerSource: event.trigger_source,
          amount: event.amount,
          isFree: event.amount === 0
        })
        await this.stageRegistrationConfirmationEmail(event, user)
      } 
      // Handle alternate selection emails
      else if (event.trigger_source === 'stripe_webhook_alternate') {
        this.logger.logPaymentProcessing('process-confirmation-emails', '📧 Triggering alternate selection email staging', { 
          triggerSource: event.trigger_source,
          amount: event.amount
        })
        await this.stageAlternateSelectionConfirmationEmail(event, user)
      }
      // Unknown trigger source
      else {
        this.logger.logPaymentProcessing('process-confirmation-emails', '⚠️ Unknown trigger source, no email staged', { 
          triggerSource: event.trigger_source,
          supportedSources: ['user_memberships', 'stripe_webhook_membership', 'free_membership', 'user_registrations', 'stripe_webhook_registration', 'free_registration', 'stripe_webhook_alternate']
        }, 'warn')
      }

    } catch (error) {
      this.logger.logPaymentProcessing('process-confirmation-emails', '❌ Failed to process confirmation emails', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      // Don't throw - email failures shouldn't break the process
    }
  }

  /**
   * Stage failed payment emails
   */
  async stageFailedPaymentEmails(event: PaymentCompletionEvent) {
    this.logger.logPaymentProcessing('send-failed-payment-emails', '📧 Sending failed payment emails...')
    
    try {
      await this.initialize()
      
      // Get user details
      const { data: user } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', event.user_id)
        .single()

      if (!user) {
        this.logger.logPaymentProcessing('send-failed-payment-emails', '❌ User not found for failed payment email', { userId: event.user_id })
        return
      }

      this.logger.logPaymentProcessing('send-failed-payment-emails', '📧 Sending payment failure email', { email: user.email })

      // Check for existing failed payment email to prevent duplicates
      const existingEmail = await this.checkExistingEmail(event, 'payment.failed')
      if (existingEmail) {
        this.logger.logPaymentProcessing('send-failed-payment-emails', '⚠️ Failed payment email already staged, skipping duplicate', { 
          existingEmailId: existingEmail.id,
          userEmail: user.email
        })
        return
      }

      // Send payment failure email using LOOPS_PAYMENT_FAILED_TEMPLATE_ID
      await emailStagingManager.stageEmail({
        user_id: event.user_id,
        email_address: user.email,
        event_type: 'payment.failed',
        subject: 'Payment Failed - Please Try Again',
        template_id: process.env.LOOPS_PAYMENT_FAILED_TEMPLATE_ID,
        email_data: {
          userName: `${user.first_name} ${user.last_name}`,
          paymentIntentId: event.metadata?.payment_intent_id || 'unknown',
          failureReason: event.metadata?.failure_reason || 'Unknown error',
          retryUrl: `${process.env.NEXTAUTH_URL}/user/memberships`,
          amount: event.amount
        },
        triggered_by: 'automated'
      })

      this.logger.logPaymentProcessing('send-failed-payment-emails', '✅ Failed payment email sent successfully')

    } catch (error) {
      this.logger.logPaymentProcessing('send-failed-payment-emails', '❌ Failed to send payment failure email', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
      // Don't throw - email failures shouldn't break the process
    }
  }


  /**
   * Check if an email has already been staged for this event
   */
  private async checkExistingEmail(event: PaymentCompletionEvent, eventType: string) {
    try {
      const { data: existingEmail } = await this.supabase
        .from('email_logs')
        .select('id, created_at')
        .eq('user_id', event.user_id)
        .eq('event_type', eventType)
        .eq('email_data->>payment_id', event.payment_id || 'null')
        .eq('email_data->>related_entity_id', event.record_id || 'null')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      return existingEmail
    } catch (error) {
      // No existing email found (this is expected)
      return null
    }
  }

  /**
   * Stage membership confirmation email
   */
  private async stageMembershipConfirmationEmail(event: PaymentCompletionEvent, user: any) {
    this.logger.logPaymentProcessing('stage-membership-confirmation-email', '📧 Starting membership email staging', { 
      paymentId: event.payment_id,
      userEmail: user.email
    })
    
    try {
      if (!event.payment_id) {
        this.logger.logPaymentProcessing('stage-membership-confirmation-email', '❌ No payment_id available for membership lookup', { 
          recordId: event.record_id
        })
        return
      }
      
      // Check for existing email to prevent duplicates
      const existingEmail = await this.checkExistingEmail(event, 'membership.purchased')
      if (existingEmail) {
        this.logger.logPaymentProcessing('stage-membership-confirmation-email', '⚠️ Email already staged, skipping duplicate', { 
          existingEmailId: existingEmail.id,
          userEmail: user.email
        })
        return
      }
      
      // Get membership details by payment_id
      const { data: membership, error: membershipError } = await this.supabase
        .from('user_memberships')
        .select(`
          *,
          memberships (
            name
          )
        `)
        .eq('payment_id', event.payment_id)
        .single()

      if (membershipError) {
        this.logger.logPaymentProcessing('stage-membership-confirmation-email', '❌ Error fetching membership', { 
          paymentId: event.payment_id,
          error: membershipError.message
        })
        return
      }

      if (!membership) {
        this.logger.logPaymentProcessing('stage-membership-confirmation-email', '❌ Membership not found', { paymentId: event.payment_id })
        
        // Let's check what user_memberships exist for this user
        const { data: allUserMemberships } = await this.supabase
          .from('user_memberships')
          .select('id, membership_id, user_id, payment_id, created_at')
          .eq('user_id', event.user_id)
          .order('created_at', { ascending: false })
          .limit(5)
        
        this.logger.logPaymentProcessing('stage-membership-confirmation-email', '🔍 Recent user memberships for debugging', { 
          paymentId: event.payment_id,
          recentMemberships: allUserMemberships
        })
        return
      }

      this.logger.logPaymentProcessing('stage-membership-confirmation-email', '✅ Membership found, staging email', { 
        email: user.email,
        membershipName: membership.memberships.name
      })

      // Stage the email for batch processing
      const stagingResult = await emailStagingManager.stageEmail({
        user_id: event.user_id,
        email_address: user.email,
        event_type: 'membership.purchased',
        subject: `Membership Confirmation - ${membership.memberships.name}`,
        template_id: process.env.LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID,
        email_data: {
          userName: `${user.first_name} ${user.last_name}`,
          membershipName: membership.memberships.name,
          amount: Number((centsToDollars(membership.amount_paid || 0)).toFixed(2)),
          durationMonths: membership.months_purchased || 1,
          validFrom: membership.valid_from,
          validUntil: membership.valid_until,
          paymentIntentId: membership.stripe_payment_intent_id || 'unknown',
          purchaseDate: toNYDateString(membership.created_at || new Date())
        },
        related_entity_type: 'user_memberships',
        related_entity_id: event.record_id || undefined,
        payment_id: event.payment_id || undefined
      })

      this.logger.logPaymentProcessing('stage-membership-confirmation-email', '📧 Email staging result', { 
        success: stagingResult,
        email: user.email
      })
      
    } catch (error) {
      this.logger.logPaymentProcessing('stage-membership-confirmation-email', '❌ Failed to stage membership email', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
    }
  }

  /**
   * Stage registration confirmation email
   */
  private async stageRegistrationConfirmationEmail(event: PaymentCompletionEvent, user: any) {
    this.logger.logPaymentProcessing('stage-registration-confirmation-email', '📧 Starting registration email staging', { 
      paymentId: event.payment_id,
      userEmail: user.email
    })
    
    try {
      if (!event.payment_id) {
        this.logger.logPaymentProcessing('stage-registration-confirmation-email', '❌ No payment_id available for registration lookup', { 
          recordId: event.record_id
        })
        return
      }
      
      // Check for existing email to prevent duplicates
      const existingEmail = await this.checkExistingEmail(event, 'registration.completed')
      if (existingEmail) {
        this.logger.logPaymentProcessing('stage-registration-confirmation-email', '⚠️ Email already staged, skipping duplicate', { 
          existingEmailId: existingEmail.id,
          userEmail: user.email
        })
        return
      }
      
      // Get registration details by payment_id
      const { data: registration, error: registrationError } = await this.supabase
        .from('user_registrations')
        .select(`
          *,
          registration:registrations (
            name,
            season:seasons (name, start_date, end_date)
          ),
          registration_category:registration_categories (
            custom_name,
            price,
            category:categories (name)
          )
        `)
        .eq('payment_id', event.payment_id)
        .single()

      if (registrationError) {
        this.logger.logPaymentProcessing('stage-registration-confirmation-email', '❌ Error fetching registration', { 
          paymentId: event.payment_id,
          error: registrationError.message
        })
        return
      }

      if (!registration) {
        this.logger.logPaymentProcessing('stage-registration-confirmation-email', '❌ Registration not found', { paymentId: event.payment_id })
        
        // Let's check what user_registrations exist for this user
        const { data: allUserRegistrations } = await this.supabase
          .from('user_registrations')
          .select('id, registration_id, user_id, payment_id, created_at')
          .eq('user_id', event.user_id)
          .order('created_at', { ascending: false })
          .limit(5)
        
        this.logger.logPaymentProcessing('stage-registration-confirmation-email', '🔍 Recent user registrations for debugging', { 
          paymentId: event.payment_id,
          recentRegistrations: allUserRegistrations
        })
        return
      }

      // Get the category name (custom_name or category.name)
      const categoryName = registration.registration_category?.custom_name || 
                          registration.registration_category?.category?.name || 
                          'Standard'

      this.logger.logPaymentProcessing('stage-registration-confirmation-email', '✅ Registration found, staging email', { 
        email: user.email,
        registrationName: registration.registration.name,
        categoryName: categoryName
      })

      // Stage the email for batch processing
      const stagingResult = await emailStagingManager.stageEmail({
        user_id: event.user_id,
        email_address: user.email,
        event_type: 'registration.completed',
        subject: `Registration Confirmation - ${registration.registration.name}`,
        template_id: process.env.LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID,
        email_data: {
          userName: `${user.first_name} ${user.last_name}`,
          registrationName: registration.registration.name,
          categoryName: categoryName,
          seasonName: registration.registration.season.name,
          amount: Number((centsToDollars(registration.amount_paid || 0)).toFixed(2)),
          paymentIntentId: registration.stripe_payment_intent_id || 'unknown',
          registrationDate: toNYDateString(registration.created_at || new Date()),
          dashboardUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://nycgha.org'
        },
        related_entity_type: 'user_registrations',
        related_entity_id: event.record_id || undefined,
        payment_id: event.payment_id || undefined
      })

      this.logger.logPaymentProcessing('stage-registration-confirmation-email', '📧 Email staging result', { 
        success: stagingResult,
        email: user.email
      })
      
    } catch (error) {
      this.logger.logPaymentProcessing('stage-registration-confirmation-email', '❌ Failed to stage registration email', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
    }
  }

  /**
   * Stage alternate selection confirmation email
   */
  private async stageAlternateSelectionConfirmationEmail(event: PaymentCompletionEvent, user: any) {
    this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '📧 Starting alternate selection email staging', { 
      paymentId: event.payment_id,
      userEmail: user.email
    })
    
    try {
      if (!event.payment_id) {
        this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '❌ No payment_id available for alternate selection lookup')
        return
      }
      
      // Check for existing email to prevent duplicates
      const existingEmail = await this.checkExistingEmail(event, 'alternate_selection.completed')
      if (existingEmail) {
        this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '⚠️ Email already staged, skipping duplicate', { 
          existingEmailId: existingEmail.id,
          userEmail: user.email
        })
        return
      }
      
      // Get alternate selection details by payment_id
      const { data: alternateSelection, error: selectionError } = await this.supabase
        .from('alternate_selections')
        .select(`
          *,
          alternate_registration:alternate_registrations (
            game_description,
            game_date,
            registration:registrations (
              name,
              season:seasons (name)
            )
          )
        `)
        .eq('payment_id', event.payment_id)
        .single()
      
      if (selectionError || !alternateSelection) {
        this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '❌ Failed to find alternate selection details', { 
          paymentId: event.payment_id,
          error: selectionError?.message
        })
        return
      }
      
      // Get payment details for amount and payment intent information
      const { data: payment } = await this.supabase
        .from('payments')
        .select('final_amount, stripe_payment_intent_id')
        .eq('id', event.payment_id)
        .single()
      
      const templateId = process.env.LOOPS_ALTERNATE_SELECTION_TEMPLATE_ID
      if (!templateId) {
        this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '❌ LOOPS_ALTERNATE_SELECTION_TEMPLATE_ID not configured', undefined, 'error')
        return
      }
      
      // Format game date for display
      // Note: Database stores TIMESTAMP WITH TIME ZONE, so we should preserve the original timezone
      const gameDate = new Date(alternateSelection.alternate_registration.game_date)
      
      // Format date and time in Eastern Time (the timezone for NYCGHA events)
      const formattedDate = gameDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'America/New_York'
      })
      
      // For time, we want to show what time it actually is in New York, regardless of how it was stored
      const formattedTime = gameDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        timeZone: 'America/New_York'
      })
      
      // Stage the email for batch processing
      const stagingResult = await emailStagingManager.stageEmail({
        user_id: event.user_id,
        email_address: user.email,
        event_type: 'alternate_selection.completed',
        subject: `Alternate Selection Confirmation - ${alternateSelection.alternate_registration.game_description}`,
        template_id: templateId,
        email_data: {
          userName: `${user.first_name} ${user.last_name}`,
          registrationName: alternateSelection.alternate_registration.registration.name,
          seasonName: alternateSelection.alternate_registration.registration.season?.name || '',
          gameDescription: alternateSelection.alternate_registration.game_description,
          gameDate: formattedDate,
          gameTime: formattedTime,
          amount: Number((centsToDollars(payment?.final_amount || event.amount)).toFixed(2)),
          paymentIntentId: payment?.stripe_payment_intent_id || 'unknown',
          purchaseDate: toNYDateString(alternateSelection.selected_at || new Date()),
          dashboardUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://nycgha.org'
        },
        related_entity_type: 'alternate_selections',
        related_entity_id: alternateSelection.id,
        payment_id: event.payment_id
      })
      
      this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '📧 Email staging result', { 
        success: stagingResult,
        email: user.email,
        gameDescription: alternateSelection.alternate_registration.game_description
      })
      
    } catch (error) {
      this.logger.logPaymentProcessing('stage-alternate-selection-confirmation-email', '❌ Failed to stage alternate selection email', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error')
    }
  }
}

// Export singleton instance for direct usage
export const emailProcessor = new EmailProcessor() 