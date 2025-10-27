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
   * Send a transactional email using Loops.so
   */
  async sendEmail(options: SendEmailOptions): Promise<{
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
      // NOTE: This method no longer creates email logs to prevent duplicates.
      // Email logging should be handled by the calling code when needed.

      // If Loops is not configured, just log and return success for development
      if (!this.loops) {
        console.log('📧 Email would be sent (Loops not configured):', {
          to: email,
          subject,
          eventType,
          data
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

      // Return success/failure based on Loops response
      if (loopsResponse && 'success' in loopsResponse && loopsResponse.success) {
        return {
          success: true,
          loopsEventId: (loopsResponse as any).id
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

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }


  /**
   * Send membership purchase confirmation email
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
    return this.sendEmail({
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
   * Send membership expiration warning email
   */
  async sendMembershipExpirationWarning(options: {
    userId: string
    email: string
    userName: string
    membershipName: string
    expirationDate: string
    daysUntilExpiration: number
  }) {
    return this.sendEmail({
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
   * Send welcome email to new users
   */
  async sendWelcomeEmail(options: {
    userId: string
    email: string
    userName: string
  }) {
    return this.sendEmail({
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
   * Send account deletion confirmation email
   */
  async sendAccountDeletionConfirmation(options: {
    userId: string
    email: string
    userName: string
    deletedAt: string
    supportEmail?: string
  }) {
    return this.sendEmail({
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
   * Send registration confirmation email
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
    return this.sendEmail({
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
   * Send waitlist added notification email
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
    return this.sendEmail({
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
   * Send waitlist selected confirmation email
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
    return this.sendEmail({
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
   * Send refund processed notification email
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
    return this.sendEmail({
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
}

// Singleton instance
export const emailService = new EmailService()