import { LoopsClient } from 'loops'
import { createClient } from '@/lib/supabase/server'
import { getWelcomeMessage } from '@/lib/organization'

// Email event types
export const EMAIL_EVENTS = {
  MEMBERSHIP_PURCHASED: 'membership.purchased',
  MEMBERSHIP_EXPIRING: 'membership.expiring',
  MEMBERSHIP_EXPIRED: 'membership.expired',
  REGISTRATION_COMPLETED: 'registration.completed',
  WAITLIST_ADDED: 'waitlist.added',
  PAYMENT_FAILED: 'payment.failed',
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
      // Log the email attempt immediately
      const logId = await this.logEmail({
        userId,
        email,
        eventType,
        subject,
        templateId,
        data,
        triggeredBy,
        triggeredByUserId,
        status: 'sent'
      })

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
        console.log(`📧 Sending email with template ID: ${templateId}`)
        console.log(`📧 Email data:`, JSON.stringify(data, null, 2))
        loopsResponse = await this.loops.sendTransactionalEmail({
          transactionalId: templateId,
          email: email,
          dataVariables: data
        })
      } else {
        // Send as a basic contact event (for triggering automations)
        console.log(`📧 No template ID provided, sending as event: ${eventType}`)
        loopsResponse = await this.loops.sendEvent({
          email: email,
          eventName: eventType,
          eventProperties: {
            subject,
            ...data
          }
        })
      }

      // Update log with Loops event ID if available
      if (loopsResponse && 'success' in loopsResponse && loopsResponse.success) {
        await this.updateEmailLog(logId, {
          loops_event_id: loopsResponse.id || 'sent',
          status: 'delivered'
        })
        
        return {
          success: true,
          loopsEventId: loopsResponse.id
        }
      } else {
        await this.updateEmailLog(logId, {
          status: 'bounced',
          bounce_reason: 'Loops API error'
        })
        
        return {
          success: false,
          error: 'Failed to send via Loops'
        }
      }

    } catch (error) {
      console.error('Email sending failed:', error)
      
      // Log the failure
      await this.logEmail({
        userId,
        email,
        eventType,
        subject,
        templateId,
        data,
        triggeredBy,
        triggeredByUserId,
        status: 'bounced',
        bounceReason: error instanceof Error ? error.message : 'Unknown error'
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Log email to database
   */
  private async logEmail(options: {
    userId: string
    email: string
    eventType: EmailEventType
    subject: string
    templateId?: string
    data?: EmailData
    triggeredBy?: 'user_action' | 'admin_send' | 'automated'
    triggeredByUserId?: string
    status: 'sent' | 'delivered' | 'bounced' | 'spam'
    bounceReason?: string
  }): Promise<string> {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('email_logs')
      .insert({
        user_id: options.userId,
        email_address: options.email,
        event_type: options.eventType,
        subject: options.subject,
        template_id: options.templateId,
        status: options.status,
        email_data: options.data || {},
        triggered_by: options.triggeredBy || 'automated',
        triggered_by_user_id: options.triggeredByUserId,
        bounce_reason: options.bounceReason
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to log email:', error)
      throw error
    }

    return data.id
  }

  /**
   * Update email log with delivery status
   */
  private async updateEmailLog(logId: string, updates: {
    loops_event_id?: string
    status?: 'sent' | 'delivered' | 'bounced' | 'spam'
    delivered_at?: Date
    opened_at?: Date
    first_clicked_at?: Date
    bounced_at?: Date
    bounce_reason?: string
  }): Promise<void> {
    const supabase = await createClient()
    
    const updateData: any = { ...updates }
    
    // Set timestamps based on status
    if (updates.status === 'delivered' && !updates.delivered_at) {
      updateData.delivered_at = new Date().toISOString()
    } else if (updates.status === 'bounced' && !updates.bounced_at) {
      updateData.bounced_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('email_logs')
      .update(updateData)
      .eq('id', logId)

    if (error) {
      console.error('Failed to update email log:', error)
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
  }) {
    return this.sendEmail({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.MEMBERSHIP_PURCHASED,
      subject: `Membership Purchase Confirmation - ${options.membershipName}`,
      triggeredBy: 'user_action',
      templateId: process.env.LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID,
      data: {
        userName: options.userName,
        membershipName: options.membershipName,
        amount: (options.amount / 100).toFixed(2),
        durationMonths: options.durationMonths,
        validFrom: options.validFrom,
        validUntil: options.validUntil,
        paymentIntentId: options.paymentIntentId,
        purchaseDate: new Date().toLocaleDateString(),
        dashboardUrl: `${process.env.NEXTAUTH_URL}/user/dashboard`
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
        renewUrl: `${process.env.NEXTAUTH_URL}/user/memberships`
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
        dashboardUrl: `${process.env.NEXTAUTH_URL}/user`,
        membershipUrl: `${process.env.NEXTAUTH_URL}/user/memberships`
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
        deletedAt: new Date(options.deletedAt).toLocaleDateString(),
        supportEmail: options.supportEmail || 'support@hockeyassociation.org',
        loginUrl: `${process.env.NEXTAUTH_URL}/auth/login`
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
  }) {
    return this.sendEmail({
      userId: options.userId,
      email: options.email,
      eventType: EMAIL_EVENTS.REGISTRATION_COMPLETED,
      subject: `Registration Confirmed - ${options.registrationName}`,
      triggeredBy: 'user_action',
      templateId: process.env.LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID,
      data: {
        userName: options.userName,
        registrationName: options.registrationName,
        categoryName: options.categoryName,
        seasonName: options.seasonName,
        amount: (options.amount / 100).toFixed(2),
        registrationDate: new Date().toLocaleDateString(),
        paymentIntentId: options.paymentIntentId,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/user/dashboard`
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
        position: options.position,
        waitlistDate: new Date().toLocaleDateString(),
        dashboardUrl: `${process.env.NEXTAUTH_URL}/user/dashboard`
      }
    })
  }
}

// Singleton instance
export const emailService = new EmailService()