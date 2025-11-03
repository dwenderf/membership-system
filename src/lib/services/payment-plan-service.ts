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
}

export interface PaymentPlanSummary {
  id: string
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
   */
  static async canUserCreatePaymentPlan(userId: string): Promise<boolean> {
    try {
      const supabase = await createClient()

      const { data: user, error } = await supabase
        .from('users')
        .select('payment_plan_enabled, stripe_payment_method_id, setup_intent_status')
        .eq('id', userId)
        .single()

      if (error || !user) {
        return false
      }

      // User must be enabled for payment plans AND have a valid saved payment method
      return (
        user.payment_plan_enabled === true &&
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
   * First payment is already processed - this creates the plan and schedules remaining payments
   */
  static async createPaymentPlan(
    data: PaymentPlanCreationData
  ): Promise<{ success: boolean; paymentPlanId?: string; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Calculate installment details
      const installmentAmount = Math.round(data.totalAmount / 4) // 25% per installment
      const firstPaymentDate = new Date()

      // Calculate next payment date (30 days from first payment)
      const nextPaymentDate = new Date(firstPaymentDate)
      nextPaymentDate.setDate(nextPaymentDate.getDate() + 30)

      logger.logPaymentProcessing(
        'payment-plan-creation-start',
        'Creating payment plan',
        {
          userId: data.userId,
          userRegistrationId: data.userRegistrationId,
          totalAmount: data.totalAmount,
          installmentAmount,
          nextPaymentDate: nextPaymentDate.toISOString().split('T')[0]
        },
        'info'
      )

      // Create payment plan record
      const { data: paymentPlan, error: planError } = await adminSupabase
        .from('payment_plans')
        .insert({
          user_registration_id: data.userRegistrationId,
          user_id: data.userId,
          total_amount: data.totalAmount,
          paid_amount: installmentAmount, // First installment already paid
          installment_amount: installmentAmount,
          installments_count: 4,
          installments_paid: 1, // First installment completed
          next_payment_date: nextPaymentDate.toISOString().split('T')[0],
          first_payment_immediate: true,
          status: 'active',
          xero_invoice_id: data.xeroInvoiceId
        })
        .select()
        .single()

      if (planError) {
        logger.logPaymentProcessing(
          'payment-plan-creation-error',
          'Failed to create payment plan record',
          {
            userId: data.userId,
            error: planError.message
          },
          'error'
        )
        return { success: false, error: 'Failed to create payment plan' }
      }

      // Create transaction record for first installment (already completed)
      const { error: firstTxError } = await adminSupabase
        .from('payment_plan_transactions')
        .insert({
          payment_plan_id: paymentPlan.id,
          payment_id: data.firstPaymentId,
          amount: installmentAmount,
          installment_number: 1,
          scheduled_date: firstPaymentDate.toISOString().split('T')[0],
          processed_date: firstPaymentDate.toISOString(),
          status: 'completed',
          attempt_count: 1
        })

      if (firstTxError) {
        logger.logPaymentProcessing(
          'payment-plan-first-transaction-error',
          'Failed to create first transaction record',
          {
            paymentPlanId: paymentPlan.id,
            error: firstTxError.message
          },
          'warn'
        )
        // Don't fail the whole operation - the plan is created
      }

      // Create transaction records for remaining 3 installments
      const remainingTransactions = []
      for (let i = 2; i <= 4; i++) {
        const scheduledDate = new Date(firstPaymentDate)
        scheduledDate.setDate(scheduledDate.getDate() + (30 * (i - 1)))

        remainingTransactions.push({
          payment_plan_id: paymentPlan.id,
          payment_id: null,
          amount: installmentAmount,
          installment_number: i,
          scheduled_date: scheduledDate.toISOString().split('T')[0],
          processed_date: null,
          status: 'pending',
          attempt_count: 0
        })
      }

      const { error: txError } = await adminSupabase
        .from('payment_plan_transactions')
        .insert(remainingTransactions)

      if (txError) {
        logger.logPaymentProcessing(
          'payment-plan-transactions-error',
          'Failed to create scheduled transaction records',
          {
            paymentPlanId: paymentPlan.id,
            error: txError.message
          },
          'error'
        )
        return { success: false, error: 'Failed to schedule future payments' }
      }

      logger.logPaymentProcessing(
        'payment-plan-creation-success',
        'Successfully created payment plan with scheduled transactions',
        {
          paymentPlanId: paymentPlan.id,
          userId: data.userId,
          userRegistrationId: data.userRegistrationId,
          totalInstallments: 4,
          installmentAmount
        },
        'info'
      )

      return { success: true, paymentPlanId: paymentPlan.id }
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
   * Process a single payment plan transaction
   */
  static async processPaymentPlanTransaction(
    transactionId: string
  ): Promise<{ success: boolean; paymentId?: string; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Get transaction details
      const { data: transaction, error: txError } = await adminSupabase
        .from('payment_plan_transactions')
        .select(`
          *,
          payment_plan:payment_plans(
            *,
            user_registration:user_registrations(
              registration:registrations(name, season:seasons(name))
            )
          )
        `)
        .eq('id', transactionId)
        .single()

      if (txError || !transaction) {
        return { success: false, error: 'Transaction not found' }
      }

      const paymentPlan = transaction.payment_plan as any

      // Get user's payment method
      const { data: user, error: userError } = await adminSupabase
        .from('users')
        .select('stripe_payment_method_id, stripe_customer_id, email, first_name, last_name')
        .eq('id', paymentPlan.user_id)
        .single()

      if (userError || !user) {
        return { success: false, error: 'User not found' }
      }

      if (!user.stripe_payment_method_id || !user.stripe_customer_id) {
        return { success: false, error: 'No saved payment method' }
      }

      // Update transaction status to processing
      await adminSupabase
        .from('payment_plan_transactions')
        .update({
          status: 'processing',
          last_attempt_at: new Date().toISOString(),
          attempt_count: transaction.attempt_count + 1
        })
        .eq('id', transactionId)

      logger.logPaymentProcessing(
        'payment-plan-transaction-processing',
        'Processing payment plan installment',
        {
          transactionId,
          installmentNumber: transaction.installment_number,
          amount: transaction.amount,
          attemptCount: transaction.attempt_count + 1
        },
        'info'
      )

      // Create Stripe payment intent
      const registrationName = paymentPlan.user_registration?.registration?.name || 'Registration'
      const seasonName = paymentPlan.user_registration?.registration?.season?.name || ''

      const paymentIntent = await stripe.paymentIntents.create({
        amount: centsToCents(transaction.amount),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id,
        confirm: true,
        off_session: true,
        receipt_email: user.email,
        metadata: {
          userId: paymentPlan.user_id,
          paymentPlanId: paymentPlan.id,
          transactionId: transaction.id,
          installmentNumber: transaction.installment_number.toString(),
          userRegistrationId: paymentPlan.user_registration_id,
          purpose: 'payment_plan_installment'
        },
        description: `Payment Plan Installment ${transaction.installment_number}/4 - ${registrationName} ${seasonName}`
      })

      // Update transaction with payment intent ID
      await adminSupabase
        .from('payment_plan_transactions')
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .eq('id', transactionId)

      // Check if payment succeeded
      if (paymentIntent.status === 'succeeded') {
        // Create payment record
        const { data: paymentRecord, error: paymentError } = await adminSupabase
          .from('payments')
          .insert({
            user_id: paymentPlan.user_id,
            total_amount: centsToCents(transaction.amount),
            final_amount: centsToCents(transaction.amount),
            stripe_payment_intent_id: paymentIntent.id,
            status: 'completed',
            payment_method: 'stripe',
            completed_at: new Date().toISOString()
          })
          .select()
          .single()

        if (paymentError) {
          logger.logPaymentProcessing(
            'payment-plan-payment-record-error',
            'Failed to create payment record',
            {
              transactionId,
              error: paymentError.message
            },
            'error'
          )
          return { success: false, error: 'Failed to create payment record' }
        }

        // Update transaction as completed
        await adminSupabase
          .from('payment_plan_transactions')
          .update({
            payment_id: paymentRecord.id,
            status: 'completed',
            processed_date: new Date().toISOString()
          })
          .eq('id', transactionId)

        // Update payment plan
        const newPaidAmount = paymentPlan.paid_amount + transaction.amount
        const newInstallmentsPaid = paymentPlan.installments_paid + 1
        const isComplete = newInstallmentsPaid >= 4

        // Calculate next payment date (30 days from now) if not complete
        let nextPaymentDate = null
        if (!isComplete) {
          const next = new Date()
          next.setDate(next.getDate() + 30)
          nextPaymentDate = next.toISOString().split('T')[0]
        }

        await adminSupabase
          .from('payment_plans')
          .update({
            paid_amount: newPaidAmount,
            installments_paid: newInstallmentsPaid,
            status: isComplete ? 'completed' : 'active',
            next_payment_date: nextPaymentDate
          })
          .eq('id', paymentPlan.id)

        logger.logPaymentProcessing(
          'payment-plan-transaction-success',
          'Successfully processed payment plan installment',
          {
            transactionId,
            paymentId: paymentRecord.id,
            installmentNumber: transaction.installment_number,
            isComplete
          },
          'info'
        )

        return { success: true, paymentId: paymentRecord.id }
      } else {
        // Payment failed or requires action
        const failureReason = `Payment status: ${paymentIntent.status}`

        await adminSupabase
          .from('payment_plan_transactions')
          .update({
            status: 'failed',
            failure_reason: failureReason
          })
          .eq('id', transactionId)

        logger.logPaymentProcessing(
          'payment-plan-transaction-failed',
          'Payment plan installment failed',
          {
            transactionId,
            installmentNumber: transaction.installment_number,
            status: paymentIntent.status,
            attemptCount: transaction.attempt_count + 1
          },
          'warn'
        )

        return { success: false, error: failureReason }
      }
    } catch (error) {
      const adminSupabase = createAdminClient()

      // Update transaction as failed
      const failureReason = error instanceof Error ? error.message : 'Unknown error'

      await adminSupabase
        .from('payment_plan_transactions')
        .update({
          status: 'failed',
          failure_reason: failureReason
        })
        .eq('id', transactionId)

      logger.logPaymentProcessing(
        'payment-plan-transaction-exception',
        'Exception processing payment plan transaction',
        {
          transactionId,
          error: failureReason
        },
        'error'
      )

      return { success: false, error: failureReason }
    }
  }

  /**
   * Process early payoff for a payment plan
   */
  static async processEarlyPayoff(
    paymentPlanId: string
  ): Promise<{ success: boolean; paymentId?: string; totalPaid?: number; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Get payment plan details
      const { data: paymentPlan, error: planError } = await adminSupabase
        .from('payment_plans')
        .select(`
          *,
          user_registration:user_registrations(
            registration:registrations(name, season:seasons(name))
          )
        `)
        .eq('id', paymentPlanId)
        .single()

      if (planError || !paymentPlan) {
        return { success: false, error: 'Payment plan not found' }
      }

      if (paymentPlan.status !== 'active') {
        return { success: false, error: 'Payment plan is not active' }
      }

      const remainingBalance = paymentPlan.total_amount - paymentPlan.paid_amount

      if (remainingBalance <= 0) {
        return { success: false, error: 'No remaining balance' }
      }

      // Get user's payment method
      const { data: user, error: userError } = await adminSupabase
        .from('users')
        .select('stripe_payment_method_id, stripe_customer_id, email, first_name, last_name')
        .eq('id', paymentPlan.user_id)
        .single()

      if (userError || !user) {
        return { success: false, error: 'User not found' }
      }

      if (!user.stripe_payment_method_id || !user.stripe_customer_id) {
        return { success: false, error: 'No saved payment method' }
      }

      logger.logPaymentProcessing(
        'payment-plan-early-payoff-start',
        'Processing early payoff for payment plan',
        {
          paymentPlanId,
          remainingBalance
        },
        'info'
      )

      // Create Stripe payment intent for remaining balance
      const registrationName = paymentPlan.user_registration?.registration?.name || 'Registration'
      const seasonName = paymentPlan.user_registration?.registration?.season?.name || ''

      const paymentIntent = await stripe.paymentIntents.create({
        amount: centsToCents(remainingBalance),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id,
        confirm: true,
        off_session: true,
        receipt_email: user.email,
        metadata: {
          userId: paymentPlan.user_id,
          paymentPlanId: paymentPlan.id,
          userRegistrationId: paymentPlan.user_registration_id,
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
      const { data: paymentRecord, error: paymentError } = await adminSupabase
        .from('payments')
        .insert({
          user_id: paymentPlan.user_id,
          total_amount: centsToCents(remainingBalance),
          final_amount: centsToCents(remainingBalance),
          stripe_payment_intent_id: paymentIntent.id,
          status: 'completed',
          payment_method: 'stripe',
          completed_at: new Date().toISOString()
        })
        .select()
        .single()

      if (paymentError) {
        return { success: false, error: 'Failed to create payment record' }
      }

      // Get all pending transactions
      const { data: pendingTransactions } = await adminSupabase
        .from('payment_plan_transactions')
        .select('id, installment_number, amount')
        .eq('payment_plan_id', paymentPlanId)
        .in('status', ['pending', 'failed'])
        .order('installment_number')

      // Mark all pending/failed transactions as completed
      if (pendingTransactions && pendingTransactions.length > 0) {
        await adminSupabase
          .from('payment_plan_transactions')
          .update({
            payment_id: paymentRecord.id,
            status: 'completed',
            processed_date: new Date().toISOString()
          })
          .eq('payment_plan_id', paymentPlanId)
          .in('status', ['pending', 'failed'])
      }

      // Update payment plan to completed
      await adminSupabase
        .from('payment_plans')
        .update({
          paid_amount: paymentPlan.total_amount,
          installments_paid: 4,
          status: 'completed',
          next_payment_date: null
        })
        .eq('id', paymentPlanId)

      logger.logPaymentProcessing(
        'payment-plan-early-payoff-success',
        'Successfully processed early payoff',
        {
          paymentPlanId,
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
          paymentPlanId,
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
   */
  static async cancelPaymentPlan(
    paymentPlanId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Update payment plan status
      const { error: updateError } = await adminSupabase
        .from('payment_plans')
        .update({
          status: 'cancelled',
          next_payment_date: null
        })
        .eq('id', paymentPlanId)

      if (updateError) {
        return { success: false, error: updateError.message }
      }

      // Cancel all pending transactions
      await adminSupabase
        .from('payment_plan_transactions')
        .update({
          status: 'failed',
          failure_reason: `Payment plan cancelled: ${reason}`
        })
        .eq('payment_plan_id', paymentPlanId)
        .eq('status', 'pending')

      logger.logPaymentProcessing(
        'payment-plan-cancelled',
        'Payment plan cancelled',
        {
          paymentPlanId,
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
          paymentPlanId,
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
   */
  static async getUserPaymentPlans(userId: string): Promise<PaymentPlanSummary[]> {
    try {
      const supabase = await createClient()

      const { data: plans, error } = await supabase
        .from('payment_plans')
        .select(`
          *,
          user_registration:user_registrations(
            registration:registrations(name)
          )
        `)
        .eq('user_id', userId)
        .in('status', ['active', 'completed'])
        .order('created_at', { ascending: false })

      if (error) {
        logger.logPaymentProcessing(
          'get-user-payment-plans-error',
          'Error fetching user payment plans',
          { userId, error: error.message },
          'error'
        )
        return []
      }

      return (plans || []).map((plan: any) => ({
        id: plan.id,
        userRegistrationId: plan.user_registration_id,
        registrationName: plan.user_registration?.registration?.name || 'Unknown',
        totalAmount: plan.total_amount,
        paidAmount: plan.paid_amount,
        remainingBalance: plan.total_amount - plan.paid_amount,
        installmentAmount: plan.installment_amount,
        installmentsCount: plan.installments_count,
        installmentsPaid: plan.installments_paid,
        nextPaymentDate: plan.next_payment_date,
        status: plan.status,
        createdAt: plan.created_at
      }))
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

      const { data: plans, error } = await supabase
        .from('payment_plans')
        .select('total_amount, paid_amount')
        .eq('user_id', userId)
        .eq('status', 'active')

      if (error || !plans || plans.length === 0) {
        return false
      }

      // Check if any plan has outstanding balance
      return plans.some(plan => plan.paid_amount < plan.total_amount)
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

      const { data: plans, error } = await supabase
        .from('payment_plans')
        .select('total_amount, paid_amount')
        .eq('user_id', userId)
        .eq('status', 'active')

      if (error || !plans) {
        return 0
      }

      return plans.reduce((total, plan) => {
        return total + (plan.total_amount - plan.paid_amount)
      }, 0)
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
