import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { centsToCents } from '@/types/currency'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

export interface PaymentPlanCreationData {
  userRegistrationId: string
  userId: string
  totalAmount: number // in cents
  xeroInvoiceId: string
  firstPaymentId: string // Payment ID for the first installment (already processed)
  tenantId: string // Xero tenant ID
}

export interface PaymentPlanSummary {
  id: string // Invoice ID
  userRegistrationId: string
  registrationName: string
  totalAmount: number
  paidAmount: number
  remainingBalance: number
  installmentAmount: number
  installmentsCount: number
  installmentsPaid: number
  nextPaymentDate: string | null
  status: string
  createdAt: string
}

export class PaymentPlanService {
  /**
   * Check if a user is eligible to create payment plans
   * Users just need a saved payment method - no separate flag needed
   */
  static async canUserCreatePaymentPlan(userId: string): Promise<boolean> {
    try {
      const supabase = await createClient()

      const { data: user, error } = await supabase
        .from('users')
        .select('stripe_payment_method_id, setup_intent_status')
        .eq('id', userId)
        .single()

      if (error || !user) {
        return false
      }

      // User must have a valid saved payment method
      return (
        !!user.stripe_payment_method_id &&
        user.setup_intent_status === 'succeeded'
      )
    } catch (error) {
      logger.logPaymentProcessing(
        'payment-plan-eligibility-check-error',
        'Error checking payment plan eligibility',
        {
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  /**
   * Create a payment plan for a registration
   * Creates 4 xero_payments records in 'staged' status
   * First payment should already be 'pending' (set by webhook later)
   */
  static async createPaymentPlan(
    data: PaymentPlanCreationData
  ): Promise<{ success: boolean; paymentPlanId?: string; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Calculate installment details
      const installmentAmount = Math.round(data.totalAmount / 4) // 25% per installment
      const firstPaymentDate = new Date()

      logger.logPaymentProcessing(
        'payment-plan-creation-start',
        'Creating payment plan xero_payments records',
        {
          userId: data.userId,
          userRegistrationId: data.userRegistrationId,
          xeroInvoiceId: data.xeroInvoiceId,
          totalAmount: data.totalAmount,
          installmentAmount
        },
        'info'
      )

      // Mark invoice as payment plan
      await adminSupabase
        .from('xero_invoices')
        .update({ is_payment_plan: true })
        .eq('id', data.xeroInvoiceId)

      // Create 4 xero_payment records, all as 'staged' initially
      const xeroPayments = []
      for (let i = 1; i <= 4; i++) {
        const scheduledDate = new Date(firstPaymentDate)
        scheduledDate.setDate(scheduledDate.getDate() + (30 * (i - 1)))

        xeroPayments.push({
          xero_invoice_id: data.xeroInvoiceId,
          tenant_id: data.tenantId,
          xero_payment_id: crypto.randomUUID(), // Placeholder, will be replaced when synced to Xero
          payment_method: 'stripe',
          amount_paid: installmentAmount,
          sync_status: 'staged', // All start as staged
          payment_type: 'installment',
          installment_number: i,
          planned_payment_date: scheduledDate.toISOString().split('T')[0],
          attempt_count: 0,
          staged_at: new Date().toISOString(),
          staging_metadata: {
            user_id: data.userId,
            user_registration_id: data.userRegistrationId,
            payment_plan_created_at: new Date().toISOString(),
            ...(i === 1 && { first_payment_id: data.firstPaymentId })
          }
        })
      }

      const { error: insertError } = await adminSupabase
        .from('xero_payments')
        .insert(xeroPayments)

      if (insertError) {
        logger.logPaymentProcessing(
          'payment-plan-creation-error',
          'Failed to create xero_payments records',
          {
            userId: data.userId,
            xeroInvoiceId: data.xeroInvoiceId,
            error: insertError.message
          },
          'error'
        )
        return { success: false, error: 'Failed to create payment plan' }
      }

      logger.logPaymentProcessing(
        'payment-plan-creation-success',
        'Successfully created payment plan xero_payments records',
        {
          xeroInvoiceId: data.xeroInvoiceId,
          userId: data.userId,
          userRegistrationId: data.userRegistrationId,
          totalInstallments: 4,
          installmentAmount
        },
        'info'
      )

      // Return the invoice ID as the "payment plan ID"
      return { success: true, paymentPlanId: data.xeroInvoiceId }
    } catch (error) {
      logger.logPaymentProcessing(
        'payment-plan-creation-exception',
        'Exception creating payment plan',
        {
          userId: data.userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return { success: false, error: 'Internal error creating payment plan' }
    }
  }

  /**
   * Process a single payment plan installment
   * Called by cron job for payments with status='planned' and planned_payment_date <= today
   */
  static async processPaymentPlanTransaction(
    xeroPaymentId: string
  ): Promise<{ success: boolean; paymentId?: string; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Get the xero_payment record with invoice and registration details
      const { data: xeroPayment, error: paymentError } = await adminSupabase
        .from('xero_payments')
        .select(`
          *,
          xero_invoice:xero_invoices(
            id,
            contact_id,
            user_registrations!inner(
              user_id,
              registration:registrations(name, season:seasons(name))
            )
          )
        `)
        .eq('id', xeroPaymentId)
        .single()

      if (paymentError || !xeroPayment) {
        return { success: false, error: 'Payment record not found' }
      }

      const invoice = xeroPayment.xero_invoice as any
      const userReg = invoice.user_registrations[0]

      // Get user's payment method
      const { data: user, error: userError } = await adminSupabase
        .from('users')
        .select('id, stripe_payment_method_id, stripe_customer_id, email, first_name, last_name')
        .eq('id', userReg.user_id)
        .single()

      if (userError || !user) {
        return { success: false, error: 'User not found' }
      }

      if (!user.stripe_payment_method_id || !user.stripe_customer_id) {
        return { success: false, error: 'No saved payment method' }
      }

      // Update status to processing
      await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'processing',
          last_attempt_at: new Date().toISOString(),
          attempt_count: xeroPayment.attempt_count + 1
        })
        .eq('id', xeroPaymentId)

      logger.logPaymentProcessing(
        'payment-plan-installment-processing',
        'Processing payment plan installment',
        {
          xeroPaymentId,
          installmentNumber: xeroPayment.installment_number,
          amount: xeroPayment.amount_paid,
          attemptCount: xeroPayment.attempt_count + 1
        },
        'info'
      )

      // Create Stripe payment intent
      const registrationName = userReg.registration?.name || 'Registration'
      const seasonName = userReg.registration?.season?.name || ''

      const paymentIntent = await stripe.paymentIntents.create({
        amount: centsToCents(xeroPayment.amount_paid),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id,
        confirm: true,
        off_session: true,
        receipt_email: user.email,
        metadata: {
          userId: user.id,
          xeroInvoiceId: xeroPayment.xero_invoice_id,
          xeroPaymentId: xeroPaymentId,
          installmentNumber: xeroPayment.installment_number.toString(),
          userRegistrationId: xeroPayment.staging_metadata?.user_registration_id || '',
          purpose: 'payment_plan_installment'
        },
        description: `Payment Plan Installment ${xeroPayment.installment_number}/4 - ${registrationName} ${seasonName}`
      })

      // Update with payment intent ID
      await adminSupabase
        .from('xero_payments')
        .update({
          staging_metadata: {
            ...xeroPayment.staging_metadata,
            stripe_payment_intent_id: paymentIntent.id
          }
        })
        .eq('id', xeroPaymentId)

      // Check if payment succeeded
      if (paymentIntent.status === 'succeeded') {
        // Create payment record in payments table
        const { data: paymentRecord, error: paymentRecordError } = await adminSupabase
          .from('payments')
          .insert({
            user_id: user.id,
            total_amount: centsToCents(xeroPayment.amount_paid),
            final_amount: centsToCents(xeroPayment.amount_paid),
            stripe_payment_intent_id: paymentIntent.id,
            status: 'completed',
            payment_method: 'stripe',
            completed_at: new Date().toISOString()
          })
          .select()
          .single()

        if (paymentRecordError) {
          logger.logPaymentProcessing(
            'payment-plan-payment-record-error',
            'Failed to create payment record',
            {
              xeroPaymentId,
              error: paymentRecordError.message
            },
            'error'
          )
          return { success: false, error: 'Failed to create payment record' }
        }

        // Update xero_payment to 'pending' (ready to sync to Xero)
        await adminSupabase
          .from('xero_payments')
          .update({
            sync_status: 'pending',
            staging_metadata: {
              ...xeroPayment.staging_metadata,
              payment_id: paymentRecord.id,
              processed_at: new Date().toISOString()
            }
          })
          .eq('id', xeroPaymentId)

        logger.logPaymentProcessing(
          'payment-plan-installment-success',
          'Successfully processed payment plan installment',
          {
            xeroPaymentId,
            paymentId: paymentRecord.id,
            installmentNumber: xeroPayment.installment_number
          },
          'info'
        )

        return { success: true, paymentId: paymentRecord.id }
      } else {
        // Payment failed or requires action
        const failureReason = `Payment status: ${paymentIntent.status}`

        await adminSupabase
          .from('xero_payments')
          .update({
            sync_status: 'planned', // Back to planned for retry
            failure_reason: failureReason
          })
          .eq('id', xeroPaymentId)

        logger.logPaymentProcessing(
          'payment-plan-installment-failed',
          'Payment plan installment failed',
          {
            xeroPaymentId,
            installmentNumber: xeroPayment.installment_number,
            status: paymentIntent.status,
            attemptCount: xeroPayment.attempt_count + 1
          },
          'warn'
        )

        return { success: false, error: failureReason }
      }
    } catch (error) {
      const adminSupabase = createAdminClient()

      // Mark as planned for retry
      const failureReason = error instanceof Error ? error.message : 'Unknown error'

      await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'planned',
          failure_reason: failureReason
        })
        .eq('id', xeroPaymentId)

      logger.logPaymentProcessing(
        'payment-plan-installment-exception',
        'Exception processing payment plan installment',
        {
          xeroPaymentId,
          error: failureReason
        },
        'error'
      )

      return { success: false, error: failureReason }
    }
  }

  /**
   * Process early payoff for a payment plan
   * Charges remaining balance and marks all planned installments as completed
   */
  static async processEarlyPayoff(
    xeroInvoiceId: string
  ): Promise<{ success: boolean; paymentId?: string; totalPaid?: number; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Get all planned payments for this invoice
      const { data: plannedPayments, error: paymentsError } = await adminSupabase
        .from('xero_payments')
        .select('*')
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('sync_status', 'planned')
        .order('installment_number')

      if (paymentsError) {
        return { success: false, error: 'Error fetching planned payments' }
      }

      if (!plannedPayments || plannedPayments.length === 0) {
        return { success: false, error: 'No planned payments found' }
      }

      const remainingBalance = plannedPayments.reduce((sum, p) => sum + p.amount_paid, 0)

      // Get user info from first planned payment
      const userId = plannedPayments[0].staging_metadata?.user_id
      if (!userId) {
        return { success: false, error: 'User ID not found in payment metadata' }
      }

      const { data: user, error: userError } = await adminSupabase
        .from('users')
        .select('stripe_payment_method_id, stripe_customer_id, email, first_name, last_name')
        .eq('id', userId)
        .single()

      if (userError || !user) {
        return { success: false, error: 'User not found' }
      }

      if (!user.stripe_payment_method_id || !user.stripe_customer_id) {
        return { success: false, error: 'No saved payment method' }
      }

      // Get registration name for description
      const { data: invoice } = await adminSupabase
        .from('xero_invoices')
        .select(`
          user_registrations!inner(
            registration:registrations(name, season:seasons(name))
          )
        `)
        .eq('id', xeroInvoiceId)
        .single()

      const userReg = invoice?.user_registrations?.[0]
      const registrationName = userReg?.registration?.name || 'Registration'
      const seasonName = userReg?.registration?.season?.name || ''

      logger.logPaymentProcessing(
        'payment-plan-early-payoff-start',
        'Processing early payoff for payment plan',
        {
          xeroInvoiceId,
          remainingBalance,
          plannedPaymentsCount: plannedPayments.length
        },
        'info'
      )

      // Create Stripe payment intent for remaining balance
      const paymentIntent = await stripe.paymentIntents.create({
        amount: centsToCents(remainingBalance),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id,
        confirm: true,
        off_session: true,
        receipt_email: user.email,
        metadata: {
          userId: userId,
          xeroInvoiceId: xeroInvoiceId,
          userRegistrationId: plannedPayments[0].staging_metadata?.user_registration_id || '',
          purpose: 'payment_plan_early_payoff'
        },
        description: `Early Payoff - ${registrationName} ${seasonName}`
      })

      if (paymentIntent.status !== 'succeeded') {
        return {
          success: false,
          error: `Payment failed: ${paymentIntent.status}`
        }
      }

      // Create payment record
      const { data: paymentRecord, error: paymentRecordError } = await adminSupabase
        .from('payments')
        .insert({
          user_id: userId,
          total_amount: centsToCents(remainingBalance),
          final_amount: centsToCents(remainingBalance),
          stripe_payment_intent_id: paymentIntent.id,
          status: 'completed',
          payment_method: 'stripe',
          completed_at: new Date().toISOString()
        })
        .select()
        .single()

      if (paymentRecordError) {
        return { success: false, error: 'Failed to create payment record' }
      }

      // Mark all planned payments as 'pending' (ready to sync to Xero)
      // Get the first planned payment to preserve staging metadata
      const { data: firstPlannedPayment } = await adminSupabase
        .from('xero_payments')
        .select('staging_metadata')
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('sync_status', 'planned')
        .limit(1)
        .single()

      await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'pending',
          staging_metadata: {
            ...(firstPlannedPayment?.staging_metadata || {}),
            payment_id: paymentRecord.id,
            early_payoff: true,
            processed_at: new Date().toISOString()
          }
        })
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('sync_status', 'planned')

      logger.logPaymentProcessing(
        'payment-plan-early-payoff-success',
        'Successfully processed early payoff',
        {
          xeroInvoiceId,
          paymentId: paymentRecord.id,
          amountPaid: remainingBalance
        },
        'info'
      )

      return {
        success: true,
        paymentId: paymentRecord.id,
        totalPaid: remainingBalance
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'payment-plan-early-payoff-exception',
        'Exception processing early payoff',
        {
          xeroInvoiceId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Cancel a payment plan
   * Marks all planned payments as failed
   */
  static async cancelPaymentPlan(
    xeroInvoiceId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Mark all planned payments as failed
      const { error: updateError } = await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'failed',
          failure_reason: `Payment plan cancelled: ${reason}`
        })
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('sync_status', 'planned')

      if (updateError) {
        return { success: false, error: updateError.message }
      }

      logger.logPaymentProcessing(
        'payment-plan-cancelled',
        'Payment plan cancelled',
        {
          xeroInvoiceId,
          reason
        },
        'info'
      )

      return { success: true }
    } catch (error) {
      logger.logPaymentProcessing(
        'payment-plan-cancellation-exception',
        'Exception cancelling payment plan',
        {
          xeroInvoiceId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get active payment plans for a user
   * Uses the payment_plan_summary view
   */
  static async getUserPaymentPlans(userId: string): Promise<PaymentPlanSummary[]> {
    try {
      const supabase = await createClient()

      // Query the payment_plan_summary view with registration data (single query to avoid N+1)
      const { data: plans, error } = await supabase
        .from('payment_plan_summary')
        .select(`
          *,
          invoice:xero_invoices!invoice_id(
            user_registrations!inner(
              id,
              registration:registrations(name)
            )
          )
        `)
        .eq('contact_id', userId)
        .in('status', ['active', 'completed'])
        .order('final_payment_date', { ascending: true })

      if (error) {
        logger.logPaymentProcessing(
          'get-user-payment-plans-error',
          'Error fetching user payment plans',
          { userId, error: error.message },
          'error'
        )
        return []
      }

      // Map plans with registration data (already fetched in single query)
      const enrichedPlans = (plans || []).map((plan: any) => {
        const userReg = plan.invoice?.user_registrations?.[0]
        const installmentAmount = plan.total_installments > 0
          ? plan.total_amount / plan.total_installments
          : 0

        return {
          id: plan.invoice_id,
          userRegistrationId: userReg?.id || '',
          registrationName: userReg?.registration?.name || 'Unknown',
          totalAmount: plan.total_amount,
          paidAmount: plan.paid_amount,
          remainingBalance: plan.total_amount - plan.paid_amount,
          installmentAmount,
          installmentsCount: plan.total_installments,
          installmentsPaid: plan.installments_paid,
          nextPaymentDate: plan.next_payment_date,
          status: plan.status,
          createdAt: plan.installments?.[0]?.staging_metadata?.payment_plan_created_at || new Date().toISOString()
        }
      })

      return enrichedPlans
    } catch (error) {
      logger.logPaymentProcessing(
        'get-user-payment-plans-exception',
        'Exception fetching user payment plans',
        {
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return []
    }
  }

  /**
   * Check if user has outstanding payment plan balance
   */
  static async hasOutstandingBalance(userId: string): Promise<boolean> {
    try {
      const supabase = await createClient()

      // Get user's payment plan invoices
      const { data: invoices } = await supabase
        .from('xero_invoices')
        .select('id')
        .eq('contact_id', userId)
        .eq('is_payment_plan', true)

      if (!invoices || invoices.length === 0) {
        return false
      }

      const invoiceIds = invoices.map(inv => inv.id)

      const { data: outstandingPayments, error: paymentsError } = await supabase
        .from('xero_payments')
        .select('id')
        .in('xero_invoice_id', invoiceIds)
        .in('sync_status', ['planned', 'staged'])
        .limit(1)

      if (paymentsError) {
        return false
      }

      return outstandingPayments && outstandingPayments.length > 0
    } catch (error) {
      logger.logPaymentProcessing(
        'check-outstanding-balance-exception',
        'Exception checking outstanding balance',
        {
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  /**
   * Get total outstanding balance for a user
   */
  static async getTotalOutstandingBalance(userId: string): Promise<number> {
    try {
      const supabase = await createClient()

      // Get user's payment plan invoices
      const { data: invoices } = await supabase
        .from('xero_invoices')
        .select('id')
        .eq('contact_id', userId)
        .eq('is_payment_plan', true)

      if (!invoices || invoices.length === 0) {
        return 0
      }

      const invoiceIds = invoices.map(inv => inv.id)

      // Sum up all planned payments
      const { data: payments, error } = await supabase
        .from('xero_payments')
        .select('amount_paid')
        .in('xero_invoice_id', invoiceIds)
        .in('sync_status', ['planned', 'staged'])

      if (error || !payments) {
        return 0
      }

      return payments.reduce((total, payment) => total + payment.amount_paid, 0)
    } catch (error) {
      logger.logPaymentProcessing(
        'get-total-outstanding-balance-exception',
        'Exception getting total outstanding balance',
        {
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return 0
    }
  }
}
