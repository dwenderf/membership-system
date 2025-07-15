/**
 * Payment Completion Processor
 * 
 * Handles async processing of completed payments via database triggers.
 * Implements hybrid approach: immediate processing + batch fallback.
 */

import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { emailService } from './email-service'
import { xeroStagingManager } from './xero/staging'
import { xeroBatchSyncManager } from './xero/batch-sync'

type PaymentCompletionEvent = {
  event_type: 'payments' | 'user_memberships' | 'user_registrations'
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

export class PaymentCompletionProcessor {
  private supabase: ReturnType<typeof createClient<Database>>
  private isListening = false

  constructor() {
    this.supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  /**
   * Start listening to payment completion notifications
   * Note: PostgreSQL NOTIFY/LISTEN requires a persistent connection
   */
  async startListening() {
    if (this.isListening) return

    console.log('🎧 Starting payment completion listener...')
    
    try {
      // For this implementation, we'll use a different approach since
      // Supabase client doesn't support PostgreSQL NOTIFY/LISTEN directly
      // Instead, we'll use realtime subscriptions on key tables
      
      const channel = this.supabase
        .channel('payment_processing')
        .on('postgres_changes', 
          { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'payments',
            filter: 'status=eq.completed'
          }, 
          (payload) => this.handlePaymentCompleted(payload)
        )
        .on('postgres_changes',
          {
            event: 'INSERT',
            schema: 'public', 
            table: 'user_memberships',
            filter: 'payment_status=eq.paid'
          },
          (payload) => this.handleMembershipCompleted(payload)
        )
        .on('postgres_changes',
          {
            event: 'INSERT', 
            schema: 'public',
            table: 'user_registrations',
            filter: 'payment_status=eq.paid'
          },
          (payload) => this.handleRegistrationCompleted(payload)
        )
        .subscribe()

      this.isListening = true
      console.log('✅ Payment completion listener started')
      return true
    } catch (error) {
      console.error('❌ Error starting payment listener:', error)
      return false
    }
  }

  /**
   * Stop listening to notifications
   */
  async stopListening() {
    if (!this.isListening) return

    await this.supabase.removeAllChannels()
    this.isListening = false
    console.log('🛑 Payment completion listener stopped')
  }

  /**
   * Handle payment completion (from payments table)
   */
  private async handlePaymentCompleted(payload: any) {
    try {
      const payment = payload.new
      
      // Only process if amount > 0 (paid purchases)
      if (!payment.final_amount || payment.final_amount <= 0) return

      console.log('🔔 Payment completed:', payment.id, `$${payment.final_amount / 100}`)

      const event: PaymentCompletionEvent = {
        event_type: 'payments',
        record_id: payment.id,
        user_id: payment.user_id,
        payment_id: payment.id,
        amount: payment.final_amount,
        trigger_source: 'payments',
        timestamp: new Date().toISOString()
      }

      await this.processPaymentCompletion(event)
    } catch (error) {
      console.error('❌ Error handling payment completion:', error)
    }
  }

  /**
   * Handle membership completion (free memberships)
   */
  private async handleMembershipCompleted(payload: any) {
    try {
      const membership = payload.new
      
      // Only process if amount = 0 (free memberships)
      if (membership.amount_paid && membership.amount_paid > 0) return

      console.log('🔔 Free membership completed:', membership.id)

      const event: PaymentCompletionEvent = {
        event_type: 'user_memberships',
        record_id: membership.id,
        user_id: membership.user_id,
        payment_id: membership.payment_id,
        amount: 0,
        trigger_source: 'user_memberships',
        timestamp: new Date().toISOString()
      }

      await this.processPaymentCompletion(event)
    } catch (error) {
      console.error('❌ Error handling membership completion:', error)
    }
  }

  /**
   * Handle registration completion (free registrations)
   */
  private async handleRegistrationCompleted(payload: any) {
    try {
      const registration = payload.new
      
      // Only process if amount = 0 (free registrations)
      if (registration.amount_paid && registration.amount_paid > 0) return

      console.log('🔔 Free registration completed:', registration.id)

      const event: PaymentCompletionEvent = {
        event_type: 'user_registrations',
        record_id: registration.id,
        user_id: registration.user_id,
        payment_id: registration.payment_id,
        amount: 0,
        trigger_source: 'user_registrations',
        timestamp: new Date().toISOString()
      }

      await this.processPaymentCompletion(event)
    } catch (error) {
      console.error('❌ Error handling registration completion:', error)
    }
  }

  /**
   * Process a payment completion event (core logic)
   */
  async processPaymentCompletion(event: PaymentCompletionEvent) {
    try {
      console.log(`🔄 Processing ${event.trigger_source} completion...`)

      // Handle failed payments differently
      if (event.metadata?.failed) {
        console.log('❌ Processing failed payment event')
        await this.sendFailedPaymentEmails(event)
        console.log(`✅ Completed processing failed ${event.trigger_source}`)
        return
      }

      // Phase 1: Create Xero staging records (always succeeds)
      await this.createXeroStagingRecords(event)

      // Phase 2: Send confirmation emails
      await this.sendConfirmationEmails(event)

      // Phase 3: Batch sync pending Xero records
      await this.syncPendingXeroRecords()

      // Phase 4: Update discount usage tracking
      await this.updateDiscountUsage(event)

      console.log(`✅ Completed processing ${event.trigger_source}`)
    } catch (error) {
      console.error(`❌ Error processing payment completion:`, error)
      
      // TODO: Log to Sentry for monitoring
      // await logToSentry(error, { event })
    }
  }

  /**
   * Phase 1: Create Xero staging records
   */
  private async createXeroStagingRecords(event: PaymentCompletionEvent) {
    console.log('📊 Creating Xero staging records...')
    
    try {
      // Skip Xero staging if no record_id (e.g., failed payments)
      if (!event.record_id) {
        console.log('⚠️ No record ID, skipping Xero staging')
        return
      }

      // Get payment details
      const paymentData = await this.getPaymentData(event)
      if (!paymentData && event.amount > 0) {
        console.log('⚠️ No payment data found for paid purchase, skipping Xero staging')
        return
      }

      // For free purchases, we still want to create invoices
      if (event.amount === 0) {
        await this.createFreeXeroStaging(event)
      } else {
        await this.createPaidXeroStaging(event, paymentData!)
      }
      
    } catch (error) {
      console.error('❌ Failed to create Xero staging records:', error)
      throw error
    }
  }

  /**
   * Create Xero staging for free purchases
   */
  private async createFreeXeroStaging(event: PaymentCompletionEvent) {
    console.log('🆓 Creating Xero staging for free purchase...')
    
    try {
      const success = await xeroStagingManager.createFreePurchaseStaging({
        user_id: event.user_id,
        record_id: event.record_id,
        trigger_source: event.trigger_source as 'user_memberships' | 'user_registrations'
      })
      
      if (success) {
        console.log('✅ Free purchase Xero staging created successfully')
      } else {
        console.log('⚠️ Free purchase Xero staging failed (non-critical)')
      }
    } catch (error) {
      console.error('❌ Error creating free Xero staging:', error)
    }
  }

  /**
   * Create Xero staging for paid purchases
   */
  private async createPaidXeroStaging(event: PaymentCompletionEvent, paymentData: any) {
    console.log('💰 Creating Xero staging for paid purchase...')
    
    try {
      const success = await xeroStagingManager.createPaidPurchaseStaging(event.payment_id!)
      
      if (success) {
        console.log('✅ Paid purchase Xero staging created successfully')
      } else {
        console.log('⚠️ Paid purchase Xero staging failed (non-critical)')
      }
    } catch (error) {
      console.error('❌ Error creating paid Xero staging:', error)
    }
  }

  /**
   * Phase 2: Send confirmation emails
   */
  private async sendConfirmationEmails(event: PaymentCompletionEvent) {
    console.log('📧 Sending confirmation emails...')
    
    try {
      // Get user details
      const { data: user } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', event.user_id)
        .single()

      if (!user) {
        console.error('❌ User not found for email:', event.user_id)
        return
      }

      if (event.trigger_source === 'user_memberships' || event.trigger_source === 'stripe_webhook_membership') {
        await this.sendMembershipConfirmationEmail(event, user)
      } else if (event.trigger_source === 'user_registrations' || event.trigger_source === 'stripe_webhook_registration') {
        await this.sendRegistrationConfirmationEmail(event, user)
      }

    } catch (error) {
      console.error('❌ Failed to send confirmation emails:', error)
      // Don't throw - email failures shouldn't break the process
    }
  }

  /**
   * Send failed payment emails
   */
  private async sendFailedPaymentEmails(event: PaymentCompletionEvent) {
    console.log('📧 Sending failed payment emails...')
    
    try {
      // Get user details
      const { data: user } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', event.user_id)
        .single()

      if (!user) {
        console.error('❌ User not found for failed payment email:', event.user_id)
        return
      }

      console.log('📧 Sending payment failure email to:', user.email)

      // Send payment failure email using LOOPS_PAYMENT_FAILED_TEMPLATE_ID
      await emailService.sendEmail({
        userId: event.user_id,
        email: user.email,
        eventType: 'payment.failed',
        subject: 'Payment Failed - Please Try Again',
        triggeredBy: 'automated',
        templateId: process.env.LOOPS_PAYMENT_FAILED_TEMPLATE_ID,
        data: {
          userName: `${user.first_name} ${user.last_name}`,
          paymentIntentId: event.metadata?.payment_intent_id || 'unknown',
          failureReason: event.metadata?.failure_reason || 'Unknown error',
          retryUrl: `${process.env.NEXTAUTH_URL}/user/memberships`,
          amount: event.amount
        }
      })

      console.log('✅ Failed payment email sent successfully')

    } catch (error) {
      console.error('❌ Failed to send payment failure email:', error)
      // Don't throw - email failures shouldn't break the process
    }
  }

  /**
   * Phase 3: Batch sync pending Xero records
   */
  private async syncPendingXeroRecords() {
    console.log('🔄 Syncing pending Xero records...')
    
    try {
      // Use the batch sync manager to sync all pending records
      const results = await xeroBatchSyncManager.syncAllPendingRecords()
      
      console.log('📊 Xero sync results:', {
        invoices: `${results.invoices.synced} synced, ${results.invoices.failed} failed`,
        payments: `${results.payments.synced} synced, ${results.payments.failed} failed`
      })
      
    } catch (error) {
      console.error('❌ Failed to sync Xero records:', error)
      // Don't throw - Xero sync failures shouldn't break other processing
    }
  }

  /**
   * Phase 4: Update discount usage tracking
   */
  private async updateDiscountUsage(event: PaymentCompletionEvent) {
    console.log('🎫 Updating discount usage...')
    
    try {
      // TODO: Implement discount usage tracking for memberships
      // Registrations already have this implemented in their flow
      
      if (event.trigger_source === 'user_memberships') {
        console.log('🚧 Membership discount usage tracking - to be implemented')
      } else {
        console.log('✅ Registration discount usage already handled in registration flow')
      }
      
    } catch (error) {
      console.error('❌ Failed to update discount usage:', error)
      // Don't throw - discount tracking failures shouldn't break other processing
    }
  }

  /**
   * Get payment data for processing
   */
  private async getPaymentData(event: PaymentCompletionEvent) {
    if (event.payment_id) {
      const { data } = await this.supabase
        .from('payments')
        .select('*')
        .eq('id', event.payment_id)
        .single()
      return data
    }

    // For free purchases, we might not have a payment record
    return null
  }

  /**
   * Send membership confirmation email
   */
  private async sendMembershipConfirmationEmail(event: PaymentCompletionEvent, user: any) {
    try {
      // Get membership details
      const { data: membership } = await this.supabase
        .from('user_memberships')
        .select(`
          *,
          memberships (
            name,
            price,
            seasons (name)
          )
        `)
        .eq('id', event.record_id)
        .single()

      if (!membership) return

      console.log('📧 Sending membership confirmation email to:', user.email)

      // Use existing email service
      await emailService.sendMembershipPurchaseConfirmation({
        user: {
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name
        },
        membership: {
          name: membership.memberships.name,
          price: membership.memberships.price,
          season_name: membership.memberships.seasons.name
        },
        amount_paid: membership.amount_paid || 0,
        valid_from: membership.valid_from,
        valid_until: membership.valid_until,
        months_purchased: membership.months_purchased || 1,
        purchase_date: membership.created_at,
        payment_intent_id: membership.stripe_payment_intent_id
      })
      
    } catch (error) {
      console.error('❌ Failed to send membership email:', error)
    }
  }

  /**
   * Send registration confirmation email
   */
  private async sendRegistrationConfirmationEmail(event: PaymentCompletionEvent, user: any) {
    try {
      // Get registration details
      const { data: registration } = await this.supabase
        .from('user_registrations')
        .select(`
          *,
          registrations (
            name,
            seasons (name, start_date, end_date)
          ),
          registration_categories (
            name,
            price
          )
        `)
        .eq('id', event.record_id)
        .single()

      if (!registration) return

      console.log('📧 Sending registration confirmation email to:', user.email)

      // Use existing email service
      await emailService.sendRegistrationConfirmation({
        user: {
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name
        },
        registration: {
          name: registration.registrations.name,
          category_name: registration.registration_categories?.name || 'Standard',
          season_name: registration.registrations.seasons.name,
          season_dates: `${registration.registrations.seasons.start_date} - ${registration.registrations.seasons.end_date}`
        },
        amount_paid: registration.amount_paid || 0,
        registration_date: registration.registered_at || registration.created_at,
        payment_intent_id: registration.stripe_payment_intent_id
      })
      
    } catch (error) {
      console.error('❌ Failed to send registration email:', error)
    }
  }

  /**
   * Manual batch processing for failed records
   */
  async processPendingRecords() {
    console.log('🔄 Starting manual batch processing...')
    
    try {
      // Find all pending Xero records and retry them
      await this.syncPendingXeroRecords()
      
      console.log('✅ Manual batch processing completed')
    } catch (error) {
      console.error('❌ Manual batch processing failed:', error)
    }
  }
}

// Export singleton instance
export const paymentProcessor = new PaymentCompletionProcessor()