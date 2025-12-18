import { LoopsClient } from 'loops'
import { formatDate } from '@/lib/date-utils'

import { createAdminClient } from '@/lib/supabase/server'
import { getWelcomeMessage } from '@/lib/organization'

// Email event types
export const EMAIL_EVENTS = {
  MEMBERSHIP_PURCHASED: 'membership.purchased',
  MEMBERSHIP_EXPIRING: 'membership.expiring',
  MEMBERSHIP_EXPIRED: 'membership.expired',
  REGISTRATION_COMPLETED: 'registration.completed',
  WAITLIST_ADDED: 'waitlist.added',
  WAITLIST_SELECTED: 'waitlist.selected',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_PROCESSED: 'refund.processed',
  WELCOME: 'user.welcome',
  ACCOUNT_DELETED: 'account.deleted',
  PAYMENT_PLAN_PRE_NOTIFICATION: 'payment_plan.pre_notification',
  PAYMENT_PLAN_PAYMENT_PROCESSED: 'payment_plan.payment_processed',
  PAYMENT_PLAN_PAYMENT_FAILED: 'payment_plan.payment_failed',
  PAYMENT_PLAN_COMPLETED: 'payment_plan.completed',
} as const

export type EmailEventType = typeof EMAIL_EVENTS[keyof typeof EMAIL_EVENTS]

interface EmailData {
  [key: string]: any
}

interface SendEmailOptions {
  userId: string
  email: string
  eventType: EmailEventType
  subject: string
  templateId?: string
  data?: EmailData
  triggeredBy?: 'user_action' | 'admin_send' | 'automated'
  triggeredByUserId?: string
}

class EmailService {
  private loops: LoopsClient
  
  constructor() {
    const apiKey = process.env.LOOPS_API_KEY
    if (!apiKey || apiKey === 'your_loops_api_key') {
      console.warn('LOOPS_API_KEY not configured. Email sending will be disabled.')
      this.loops = null as any
    } else {
      this.loops = new LoopsClient(apiKey)
    }
  }

  /**
   * Send a transactional email immediately (bypasses queue).
   *
   * This method sends emails directly to Loops API without queuing.
   * Emails are logged to email_logs with status='sent' or 'failed' for tracking.
   *
   * For queued emails (recommended), use emailStagingManager.stageEmail() instead.
   */
  async sendEmailImmediately(options: SendEmailOptions): Promise<{
    success: boolean
    loopsEventId?: string
    error?: string
  }> {
    const {
      userId,
      email,
      eventType,
      subject,
      templateId,
      data = {},
      triggeredBy = 'automated',
      triggeredByUserId
    } = options

    try {
      // If Loops is not configured, log to database and console for development tracking
      if (!this.loops) {
        console.log('📧 Email would be sent (Loops not configured):', {
          to: email,
          subject,
          eventType,
          data
        })

        // Still log to email_logs so developers can track what would have been sent
        await this.logEmailToDatabase({
          userId,
          email,
          eventType,
          subject,
          templateId,
          status: 'failed',
          triggeredBy,
          triggeredByUserId,
          data,
          bounceReason: 'Loops not configured - development mode'
        })

        return { success: true }
      }

      // Send email via Loops.so
      let loopsResponse
      if (templateId) {
        // Send using a template
        // Clean data to ensure no undefined values
        const cleanData = Object.fromEntries(
          Object.entries(data).filter(([_, value]) => value !== undefined)
        )

        loopsResponse = await this.loops.sendTransactionalEmail({
          transactionalId: templateId,
          email: email,
          dataVariables: cleanData
        })
      } else {
        // Send as a basic contact event (for triggering automations)
        loopsResponse = await this.loops.sendEvent({
          email: email,
          eventName: eventType,
          eventProperties: {
            subject,
            ...data
          }
        })
      }

      // Determine success/failure based on Loops response
      const sendSucceeded = loopsResponse && 'success' in loopsResponse && loopsResponse.success
      const loopsEventId = sendSucceeded ? (loopsResponse as any).id : undefined

      // Log to email_logs for tracking (even for immediate sends)
      await this.logEmailToDatabase({
        userId,
        email,
        eventType,
        subject,
        templateId,
        status: sendSucceeded ? 'sent' : 'failed',
        triggeredBy,
        triggeredByUserId,
        data,
        loopsEventId,
        bounceReason: sendSucceeded ? undefined : 'Failed to send via Loops'
      })

      if (sendSucceeded) {
        return {
          success: true,
          loopsEventId
        }
      } else {
        return {
          success: false,
          error: 'Failed to send via Loops'
        }
      }

    } catch (error) {
      console.error('Email sending failed:', error)

      // Log additional error details if available
      if (error && typeof error === 'object' && 'json' in error) {
        console.error('Loops.so API error details:', (error as any).json)
      }

      // Try to log the failure
      await this.logEmailToDatabase({
        userId,
        email,
        eventType,
        subject,
        templateId,
        status: 'failed',
        triggeredBy,
        triggeredByUserId,
        data,
        bounceReason: error instanceof Error ? error.message : 'Unknown error'
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Helper method to log email sends to the database
   *
   * Extracted to reduce code duplication between success/failure paths.
   * Logs are used for tracking and debugging email delivery.
   */
  private async logEmailToDatabase(params: {
    userId: string
    email: string
    eventType: EmailEventType
    subject: string
    templateId?: string
    status: 'sent' | 'failed'
    triggeredBy?: 'user_action' | 'admin_send' | 'automated'
    triggeredByUserId?: string
    data?: EmailData
    loopsEventId?: string
    bounceReason?: string
  }): Promise<void> {
    try {
      const supabase = createAdminClient()
      await supabase
        .from('email_logs')
        .insert({
          user_id: params.userId,
          email_address: params.email,
          event_type: params.eventType,
          subject: params.subject,
          template_id: params.templateId,
          status: params.status,
          triggered_by: params.triggeredBy,
          triggered_by_user_id: params.triggeredByUserId,
          email_data: params.data,
          loops_event_id: params.loopsEventId || null,
          bounce_reason: params.bounceReason || null,
          sent_at: new Date().toISOString()
        })
    } catch (logError) {
      console.error('Failed to log email to database:', logError)
      // Don't throw - we don't want to fail the operation just because logging failed
    }
  }

  /**
   * Send membership purchase confirmation email immediately (bypasses queue)
   */
  async sendMembershipPurchaseConfirmation(options: {
    userId: string
    email: string
    userName: string
    membershipName: string
    amount: number
    durationMonths: number
    validFrom: string
    validUntil: string
    paymentIntentId: string
    triggeredBy?: 'user_action' | 'admin_send' | 'automated'
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.MEMBERSHIP_PURCHASED,
      subject: `Membership Purchase Confirmation - ${options.membershipName}`,
      triggeredBy: options.triggeredBy || 'user_action',
      templateId: process.env.LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID,
      data: {
        userName: options.userName,
        membershipName: options.membershipName,
        amount: (options.amount / 100).toFixed(2),
        durationMonths: options.durationMonths,
        validFrom: options.validFrom,
        validUntil: options.validUntil,
        paymentIntentId: options.paymentIntentId,
        purchaseDate: formatDate(new Date()),
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      }
    })
  }

  /**
   * Send membership expiration warning email immediately (bypasses queue)
   */
  async sendMembershipExpirationWarning(options: {
    userId: string
    email: string
    userName: string
    membershipName: string
    expirationDate: string
    daysUntilExpiration: number
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.MEMBERSHIP_EXPIRING,
      subject: `Your ${options.membershipName} expires in ${options.daysUntilExpiration} days`,
      triggeredBy: 'automated',
      data: {
        userName: options.userName,
        membershipName: options.membershipName,
        expirationDate: options.expirationDate,
        daysUntilExpiration: options.daysUntilExpiration,
        renewUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/memberships`
      }
    })
  }

  /**
   * Send welcome email to new users immediately (bypasses queue)
   */
  async sendWelcomeEmail(options: {
    userId: string
    email: string
    userName: string
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.WELCOME,
      subject: getWelcomeMessage(),
      triggeredBy: 'automated',
      data: {
        userName: options.userName,
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user`,
        membershipUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/memberships`
      }
    })
  }

  /**
   * Send account deletion confirmation email immediately (bypasses queue)
   */
  async sendAccountDeletionConfirmation(options: {
    userId: string
    email: string
    userName: string
    deletedAt: string
    supportEmail?: string
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.ACCOUNT_DELETED,
      subject: 'Account Deletion Confirmation',
      triggeredBy: 'user_action',
      data: {
        userName: options.userName,
        deletedAt: formatDate(new Date(options.deletedAt)),
        supportEmail: options.supportEmail || 'support@hockeyassociation.org',
        loginUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/login`
      }
    })
  }

  /**
   * Send registration confirmation email immediately (bypasses queue)
   */
  async sendRegistrationConfirmation(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    categoryName: string
    seasonName: string
    amount: number
    paymentIntentId: string
    triggeredBy?: 'user_action' | 'admin_send' | 'automated'
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.REGISTRATION_COMPLETED,
      subject: `Registration Confirmed - ${options.registrationName}`,
      triggeredBy: options.triggeredBy || 'user_action',
      templateId: process.env.LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID,
      data: {
        userName: options.userName,
        registrationName: options.registrationName,
        categoryName: options.categoryName,
        seasonName: options.seasonName,
        amount: (options.amount / 100).toFixed(2),
        registrationDate: formatDate(new Date()),
        paymentIntentId: options.paymentIntentId,
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      }
    })
  }

  /**
   * Send waitlist added notification email immediately (bypasses queue)
   */
  async sendWaitlistAddedNotification(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    categoryName: string
    seasonName: string
    position: number
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.WAITLIST_ADDED,
      subject: `Added to Waitlist - ${options.registrationName}`,
      triggeredBy: 'user_action',
      templateId: process.env.LOOPS_WAITLIST_ADDED_TEMPLATE_ID,
      data: {
        userName: options.userName,
        registrationName: options.registrationName,
        categoryName: options.categoryName,
        seasonName: options.seasonName,
        waitlistDate: formatDate(new Date()),
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      }
    })
  }

  /**
   * Send waitlist selected confirmation email immediately (bypasses queue)
   */
  async sendWaitlistSelectedNotification(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    categoryName: string
    seasonName: string
    amountCharged: number
    paymentIntentId?: string
    discountApplied?: string
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.WAITLIST_SELECTED,
      subject: `Selected from Waitlist - ${options.registrationName}`,
      triggeredBy: 'admin_send',
      templateId: process.env.LOOPS_WAITLIST_SELECTED_TEMPLATE_ID,
      data: {
        userName: options.userName,
        registrationName: options.registrationName,
        categoryName: options.categoryName,
        seasonName: options.seasonName,
        amount: (options.amountCharged / 100).toFixed(2), // Loops expects 'amount' not 'amountCharged'
        purchaseDate: formatDate(new Date()), // Loops expects 'purchaseDate' not 'paymentDate'
        paymentIntentId: options.paymentIntentId || 'N/A',
        discountApplied: options.discountApplied || '',
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/registrations`
      }
    })
  }

  /**
   * Send refund processed notification email immediately (bypasses queue)
   */
  async sendRefundNotification(options: {
    userId: string
    email: string
    userName: string
    refundAmount: number
    originalAmount: number
    reason?: string
    paymentDate: string
    invoiceNumber?: string
    refundDate?: string
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.REFUND_PROCESSED,
      subject: `Refund Processed - $${(options.refundAmount / 100).toFixed(2)}`,
      triggeredBy: 'admin_send',
      templateId: process.env.LOOPS_REFUND_TEMPLATE_ID,
      data: {
        userName: options.userName,
        refundAmount: (options.refundAmount / 100).toFixed(2),
        originalAmount: (options.originalAmount / 100).toFixed(2),
        reason: options.reason || 'Refund processed by administrator',
        paymentDate: options.paymentDate,
        invoiceNumber: options.invoiceNumber || 'N/A',
        refundDate: options.refundDate || formatDate(new Date()),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      }
    })
  }

  /**
   * Send payment plan pre-notification email (3 days before charge) immediately (bypasses queue)
   */
  async sendPaymentPlanPreNotification(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    installmentNumber: number
    totalInstallments: number
    installmentAmount: number
    nextPaymentDate: string
    amountPaid: number
    remainingBalance: number
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.PAYMENT_PLAN_PRE_NOTIFICATION,
      subject: `Upcoming Payment Plan Installment - ${options.registrationName}`,
      triggeredBy: 'automated',
      templateId: process.env.LOOPS_PAYMENT_PLAN_PRE_NOTIFICATION_TEMPLATE_ID,
      data: {
        user_name: options.userName,
        registration_name: options.registrationName,
        installment_number: options.installmentNumber,
        total_installments: options.totalInstallments,
        installment_amount: `$${(options.installmentAmount / 100).toFixed(2)}`,
        next_payment_date: formatDate(new Date(options.nextPaymentDate)),
        amount_paid: `$${(options.amountPaid / 100).toFixed(2)}`,
        remaining_balance: `$${(options.remainingBalance / 100).toFixed(2)}`,
        account_settings_url: `${process.env.NEXT_PUBLIC_SITE_URL}/account/settings`
      }
    })
  }

  /**
   * Send payment plan payment processed email immediately (bypasses queue)
   */
  async sendPaymentPlanPaymentProcessed(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    installmentNumber: number
    totalInstallments: number
    installmentAmount: number
    paymentDate: string
    amountPaid: number
    remainingBalance: number
    nextPaymentDate?: string
    isFinalPayment: boolean
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.PAYMENT_PLAN_PAYMENT_PROCESSED,
      subject: `Payment Plan Installment Processed - ${options.registrationName}`,
      triggeredBy: 'automated',
      templateId: process.env.LOOPS_PAYMENT_PLAN_PAYMENT_PROCESSED_TEMPLATE_ID,
      data: {
        user_name: options.userName,
        registration_name: options.registrationName,
        installment_number: options.installmentNumber,
        total_installments: options.totalInstallments,
        installment_amount: `$${(options.installmentAmount / 100).toFixed(2)}`,
        payment_date: formatDate(new Date(options.paymentDate)),
        amount_paid: `$${(options.amountPaid / 100).toFixed(2)}`,
        remaining_balance: `$${(options.remainingBalance / 100).toFixed(2)}`,
        has_next_payment: !!options.nextPaymentDate && !options.isFinalPayment,
        next_payment_date: (options.nextPaymentDate && !options.isFinalPayment)
          ? formatDate(new Date(options.nextPaymentDate))
          : 'No more payments due',
        is_final_payment: options.isFinalPayment,
        dashboard_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      }
    })
  }

  /**
   * Send payment plan payment failed email immediately (bypasses queue)
   */
  async sendPaymentPlanPaymentFailed(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    installmentNumber: number
    totalInstallments: number
    installmentAmount: number
    scheduledDate: string
    failureReason: string
    remainingRetries: number
    amountPaid: number
    remainingBalance: number
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.PAYMENT_PLAN_PAYMENT_FAILED,
      subject: `Action Required: Payment Plan Installment Failed - ${options.registrationName}`,
      triggeredBy: 'automated',
      templateId: process.env.LOOPS_PAYMENT_PLAN_PAYMENT_FAILED_TEMPLATE_ID,
      data: {
        user_name: options.userName,
        registration_name: options.registrationName,
        installment_number: options.installmentNumber,
        total_installments: options.totalInstallments,
        installment_amount: `$${(options.installmentAmount / 100).toFixed(2)}`,
        scheduled_date: formatDate(new Date(options.scheduledDate)),
        failure_reason: options.failureReason,
        remaining_retries: options.remainingRetries,
        amount_paid: `$${(options.amountPaid / 100).toFixed(2)}`,
        remaining_balance: `$${(options.remainingBalance / 100).toFixed(2)}`,
        account_settings_url: `${process.env.NEXT_PUBLIC_SITE_URL}/account/settings`
      }
    })
  }

  /**
   * Send payment plan completed email immediately (bypasses queue)
   */
  async sendPaymentPlanCompleted(options: {
    userId: string
    email: string
    userName: string
    registrationName: string
    totalAmount: number
    totalInstallments: number
    planStartDate: string
    completionDate: string
  }) {
    return this.sendEmailImmediately({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.PAYMENT_PLAN_COMPLETED,
      subject: `Payment Plan Complete! 🎉 - ${options.registrationName}`,
      triggeredBy: 'automated',
      templateId: process.env.LOOPS_PAYMENT_PLAN_COMPLETED_TEMPLATE_ID,
      data: {
        user_name: options.userName,
        registration_name: options.registrationName,
        total_amount: `$${(options.totalAmount / 100).toFixed(2)}`,
        total_installments: options.totalInstallments,
        plan_start_date: formatDate(new Date(options.planStartDate)),
        completion_date: formatDate(new Date(options.completionDate)),
        dashboard_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      }
    })
  }
}

// Singleton instance
export const emailService = new EmailService()