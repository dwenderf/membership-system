import { getStripe } from '@/lib/stripe/server-client'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { centsToCents } from '@/types/currency'
import { PAYMENT_PLAN_INSTALLMENTS, INSTALLMENT_INTERVAL_DAYS } from './payment-plan-config'
import { toDateString } from '@/lib/date-utils'
import { userHasValidPaymentMethod } from '@/lib/payment-method-utils'
import { completeEarlyPayoff, hasEarlyPayoffInFlight } from './early-payoff-completion'

export const EARLY_PAYOFF_SUPERSEDED_REASON = 'Superseded by early payoff payment'

export type EarlyPayoffErrorCode = 'nothing_to_pay' | 'in_progress' | 'processing' | 'charge_failed'

interface ClaimedInstallment {
  id: string
  amount_paid: number
  tenant_id: string | null
  installment_number: number | null
  staging_metadata: { user_registration_id?: string } | null
}

/** Stripe idempotency key for an early payoff charge: one per claim (#452). */
export function earlyPayoffIdempotencyKey(xeroInvoiceId: string, amountCents: number, stagedPaymentId: string): string {
  return `early-payoff:${xeroInvoiceId}:${amountCents}:${stagedPaymentId}`
}

/** Stripe idempotency key for an installment charge: one per (installment, attempt) (#452). */
export function installmentIdempotencyKey(xeroPaymentId: string, attempt: number): string {
  return `installment:${xeroPaymentId}:attempt:${attempt}`
}

function isStripeCardError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { type?: string }).type === 'StripeCardError'
}

/** Shape of the `xero_invoice` relation as selected below — not the full DB row,
 * just the nested fields queried and read downstream. */
interface DuePaymentInvoiceJoin {
  id: string
  user_registrations: Array<{
    user_id: string
    registration: { name: string; season: { name: string } | null } | null
  }>
}

/** Row shape of the `payment_plan_summary` view as consumed by getUserPaymentPlans. */
interface PaymentPlanSummaryViewRow {
  invoice_id: string
  registration_id: string | null
  registration_name: string | null
  total_amount: number
  paid_amount: number
  total_installments: number
  installments_paid: number
  next_payment_date: string | null
  status: string
}

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
  createdAt: string | null // From xero_invoices.created_at (should always exist, but nullable for safety)
}

export class PaymentPlanService {
  /**
   * Check if a user is eligible to create payment plans
   * Requires both admin approval (payment_plan_enabled) and saved payment method
   */
  static async canUserCreatePaymentPlan(userId: string): Promise<boolean> {
    try {
      const supabase = await createClient()

      const { data: user, error } = await supabase
        .from('users')
        .select('stripe_payment_method_id, setup_intent_status, payment_plan_enabled')
        .eq('id', userId)
        .single()

      if (error || !user) {
        return false
      }

      // User must be admin-approved AND have a valid saved payment method
      return (
        user.payment_plan_enabled === true &&
        userHasValidPaymentMethod(user)
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
   * Creates 4 xero_payments records, all initially as 'staged'
   * Webhook later promotes payment #1 to 'pending' and #2-4 to 'planned'
   */
  static async createPaymentPlan(
    data: PaymentPlanCreationData
  ): Promise<{ success: boolean; paymentPlanId?: string; error?: string }> {
    try {
      const adminSupabase = createAdminClient()

      // Calculate installment details
      const installmentAmount = Math.round(data.totalAmount / PAYMENT_PLAN_INSTALLMENTS)
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
      const { error: updateError } = await adminSupabase
        .from('xero_invoices')
        .update({ is_payment_plan: true })
        .eq('id', data.xeroInvoiceId)

      if (updateError) {
        logger.logPaymentProcessing(
          'create-payment-plan-invoice-update-error',
          'Failed to mark invoice as payment plan',
          { xeroInvoiceId: data.xeroInvoiceId, error: updateError.message },
          'error'
        )
        return { success: false, error: 'Failed to update invoice' }
      }

      // Create xero_payment records, all as 'staged' initially
      const xeroPayments = []
      for (let i = 1; i <= PAYMENT_PLAN_INSTALLMENTS; i++) {
        const scheduledDate = new Date(firstPaymentDate)
        scheduledDate.setDate(scheduledDate.getDate() + (INSTALLMENT_INTERVAL_DAYS * (i - 1)))

        // For the last installment, absorb any rounding remainder to ensure exact total
        const paymentAmount = i === PAYMENT_PLAN_INSTALLMENTS
          ? data.totalAmount - (installmentAmount * (PAYMENT_PLAN_INSTALLMENTS - 1))
          : installmentAmount

        xeroPayments.push({
          xero_invoice_id: data.xeroInvoiceId,
          tenant_id: data.tenantId,
          xero_payment_id: null, // Will be populated when synced to Xero
          payment_method: 'stripe',
          amount_paid: paymentAmount,
          sync_status: 'staged', // All start as staged
          payment_type: 'installment',
          installment_number: i,
          planned_payment_date: toDateString(scheduledDate),
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
  ): Promise<{ success: boolean; paymentId?: string; error?: string; skipped?: boolean }> {
    let claimedForCharge = false
    try {
      const adminSupabase = createAdminClient()

      // Get the xero_payment record with invoice and registration details
      const { data: xeroPayment, error: paymentError } = await adminSupabase
        .from('xero_payments')
        .select(`
          *,
          xero_invoice:xero_invoices(
            id,
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

      const invoice = xeroPayment.xero_invoice as DuePaymentInvoiceJoin
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

      if (xeroPayment.sync_status !== 'planned') {
        return { success: false, skipped: true, error: `Installment is '${xeroPayment.sync_status}', not planned` }
      }

      // Don't charge an installment while an early payoff for the same plan is in flight (#452).
      if (await hasEarlyPayoffInFlight(adminSupabase, xeroPayment.xero_invoice_id)) {
        return { success: false, skipped: true, error: 'Early payoff in progress for this plan' }
      }

      // Conditional claim (#452): planned -> processing only if still planned, so an early payoff
      // (or another cron run) that got there first wins and this run charges nothing.
      const attempt = xeroPayment.attempt_count + 1
      const { data: claimedRow, error: claimError } = await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'processing',
          last_attempt_at: new Date().toISOString(),
          attempt_count: attempt
        })
        .eq('id', xeroPaymentId)
        .eq('sync_status', 'planned')
        .select('id')
        .maybeSingle()

      if (claimError) {
        return { success: false, error: `Failed to claim installment: ${claimError.message}` }
      }
      if (!claimedRow) {
        return { success: false, skipped: true, error: 'Installment is no longer planned' }
      }
      claimedForCharge = true

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

      const paymentIntent = await getStripe().paymentIntents.create({
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
      }, { idempotencyKey: installmentIdempotencyKey(xeroPaymentId, attempt) })

      // Update with payment intent ID
      await adminSupabase
        .from('xero_payments')
        .update({
          staging_metadata: {
            ...(xeroPayment.staging_metadata || {}),
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
              ...(xeroPayment.staging_metadata || {}),
              // Re-state the intent ID: this update replaces the whole jsonb column, and
              // xeroPayment.staging_metadata predates the update that recorded it (#382).
              stripe_payment_intent_id: paymentIntent.id,
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
          .eq('sync_status', 'processing')

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

      // Only undo our own claim: never resurrect a row that an early payoff cancelled (#452).
      if (claimedForCharge) {
        await adminSupabase
          .from('xero_payments')
          .update({
            sync_status: 'planned',
            failure_reason: failureReason
          })
          .eq('id', xeroPaymentId)
          .eq('sync_status', 'processing')
      }

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
   * Process early payoff for a payment plan (#452).
   *
   * 1. Atomically claim the planned installments (planned -> cancelled, conditional UPDATE that
   *    returns the rows it changed). Only one concurrent request can claim a given row, and the
   *    amount charged is computed from the rows this request claimed.
   * 2. Stage one 'full' xero_payments row (early_payoff) - a unique partial index allows only one
   *    live early payoff per invoice - and a pending payments row.
   * 3. Charge Stripe with an idempotency key tied to this claim.
   * 4. On success, mark paid synchronously via completeEarlyPayoff (the webhook repeats it as a
   *    backstop). On a definite failure (declined, requires_action, ...) roll back: restore the
   *    claimed rows to planned, cancel the staged row, fail the payment.
   */
  static async processEarlyPayoff(
    xeroInvoiceId: string,
    userId: string
  ): Promise<{ success: boolean; paymentId?: string; totalPaid?: number; error?: string; code?: EarlyPayoffErrorCode }> {
    const adminSupabase = createAdminClient()
    let claimed: ClaimedInstallment[] = []
    let stagedPaymentId: string | null = null
    let paymentRecordId: string | null = null
    let chargeAttempted = false

    const rollback = async (reason: string) => {
      await PaymentPlanService.rollbackEarlyPayoff(adminSupabase, {
        xeroInvoiceId,
        claimedIds: claimed.map(c => c.id),
        stagedPaymentId,
        paymentRecordId,
        reason
      })
    }

    try {
      // Cheap pre-checks first, so a member without a card doesn't claim anything.
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

      if (await hasEarlyPayoffInFlight(adminSupabase, xeroInvoiceId)) {
        return { success: false, code: 'in_progress', error: 'A payoff for this payment plan is already in progress' }
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
      const registration = Array.isArray(userReg?.registration) ? userReg?.registration[0] : userReg?.registration
      const registrationName = registration?.name || 'Registration'
      const season = Array.isArray(registration?.season) ? registration?.season[0] : registration?.season
      const seasonName = season?.name || ''

      // Step 1: atomic claim. Postgres row locks make concurrent claims serialize; the loser
      // re-evaluates sync_status='planned' and gets zero rows back.
      const { data: claimedRows, error: claimError } = await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'cancelled',
          failure_reason: EARLY_PAYOFF_SUPERSEDED_REASON
        })
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('sync_status', 'planned')
        .select('id, amount_paid, tenant_id, installment_number, staging_metadata')

      if (claimError) {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-claim-error',
          'Failed to claim planned payments for early payoff',
          { xeroInvoiceId, error: claimError.message },
          'error'
        )
        return { success: false, error: 'Failed to claim planned payments' }
      }

      claimed = ((claimedRows || []) as ClaimedInstallment[])
        .slice()
        .sort((a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0))

      if (claimed.length === 0) {
        return {
          success: false,
          code: 'nothing_to_pay',
          error: 'Payment plan is already completed or a payoff is already in progress'
        }
      }

      const remainingBalance = claimed.reduce((sum, p) => sum + p.amount_paid, 0)
      const userRegistrationId = claimed[0].staging_metadata?.user_registration_id || ''

      logger.logPaymentProcessing(
        'payment-plan-early-payoff-start',
        'Processing early payoff for payment plan',
        { xeroInvoiceId, remainingBalance, claimedCount: claimed.length },
        'info'
      )

      // Step 2: payment record first, so the staged row can point at it.
      const { data: paymentRecord, error: paymentRecordError } = await adminSupabase
        .from('payments')
        .insert({
          user_id: userId,
          total_amount: centsToCents(remainingBalance),
          final_amount: centsToCents(remainingBalance),
          status: 'pending',
          payment_method: 'stripe'
        })
        .select()
        .single()

      if (paymentRecordError || !paymentRecord) {
        await rollback('Failed to create payment record')
        return { success: false, error: 'Failed to create payment record' }
      }
      paymentRecordId = paymentRecord.id

      // Step 3: the staged early-payoff row. The unique partial index
      // (xero_payments_one_live_early_payoff) rejects a second live one for this invoice.
      const { data: stagedPayment, error: stagedPaymentError } = await adminSupabase
        .from('xero_payments')
        .insert({
          xero_invoice_id: xeroInvoiceId,
          tenant_id: claimed[0].tenant_id,
          xero_payment_id: null,
          payment_method: 'stripe',
          amount_paid: remainingBalance,
          sync_status: 'staged',
          payment_type: 'full',
          staged_at: new Date().toISOString(),
          staging_metadata: {
            user_id: userId,
            user_registration_id: userRegistrationId,
            early_payoff: true,
            original_plan_amount: remainingBalance,
            cancelled_payments_count: claimed.length,
            cancelled_payment_ids: claimed.map(c => c.id),
            payment_id: paymentRecord.id
          }
        })
        .select()
        .single()

      if (stagedPaymentError || !stagedPayment) {
        const duplicate = stagedPaymentError?.code === '23505'
        await rollback(duplicate ? 'Another early payoff is already live' : 'Failed to create staged payment')
        return duplicate
          ? { success: false, code: 'in_progress', error: 'A payoff for this payment plan is already in progress' }
          : { success: false, error: 'Failed to create staged payment record' }
      }
      stagedPaymentId = stagedPayment.id

      // Step 4: charge. The key is unique to this claim (invoice + amount + the staged row that
      // owns the claimed installments), so a retried create can't charge twice, while a fresh
      // attempt after a rollback (e.g. with a new card) gets a fresh key.
      chargeAttempted = true
      const idempotencyKey = earlyPayoffIdempotencyKey(xeroInvoiceId, remainingBalance, stagedPayment.id)
      const paymentIntent = await getStripe().paymentIntents.create(
        {
          amount: centsToCents(remainingBalance),
          currency: 'usd',
          payment_method: user.stripe_payment_method_id,
          customer: user.stripe_customer_id,
          confirm: true,
          off_session: true,
          receipt_email: user.email,
          metadata: {
            userId: userId,
            xeroStagingRecordId: xeroInvoiceId, // Webhook uses this to find staged payment
            userRegistrationId,
            purpose: 'payment_plan_early_payoff',
            paymentId: paymentRecord.id,
            xeroPaymentId: stagedPayment.id,
            registrationName: registrationName,
            seasonName: seasonName
          },
          description: `Early Payoff - ${registrationName} ${seasonName}`
        },
        { idempotencyKey }
      )

      // Record the intent on both rows so the webhook can find them by stripe_payment_intent_id.
      await adminSupabase
        .from('payments')
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .eq('id', paymentRecord.id)
      await adminSupabase
        .from('xero_payments')
        .update({
          staging_metadata: { ...(stagedPayment.staging_metadata || {}), stripe_payment_intent_id: paymentIntent.id }
        })
        .eq('id', stagedPayment.id)
        .eq('sync_status', 'staged')

      if (paymentIntent.status === 'succeeded') {
        await completeEarlyPayoff(adminSupabase, paymentIntent)

        logger.logPaymentProcessing(
          'payment-plan-early-payoff-success',
          'Successfully charged and completed early payoff',
          { xeroInvoiceId, paymentId: paymentRecord.id, paymentIntentId: paymentIntent.id, amountPaid: remainingBalance },
          'info'
        )
        return { success: true, paymentId: paymentRecord.id, totalPaid: remainingBalance }
      }

      if (paymentIntent.status === 'processing') {
        // Not failed - the webhook completes it. Leave the claim in place (it blocks new payoffs).
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-processing',
          'Early payoff charge is processing; webhook will complete it',
          { xeroInvoiceId, paymentIntentId: paymentIntent.id },
          'warn'
        )
        return { success: false, code: 'processing', error: 'Your payment is processing. Please check back shortly.' }
      }

      // requires_action / requires_payment_method / canceled: nothing was captured.
      if (paymentIntent.status !== 'canceled') {
        try {
          await getStripe().paymentIntents.cancel(paymentIntent.id)
        } catch (cancelErr) {
          logger.logPaymentProcessing(
            'payment-plan-early-payoff-cancel-intent-failed',
            'Failed to cancel unconfirmed early payoff PaymentIntent',
            { paymentIntentId: paymentIntent.id, error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr) },
            'warn'
          )
        }
      }
      await rollback(`Payment status: ${paymentIntent.status}`)
      logger.logPaymentProcessing(
        'payment-plan-early-payoff-charge-failed',
        'Stripe charge failed for early payoff; claim rolled back',
        { xeroInvoiceId, paymentIntentId: paymentIntent.id, status: paymentIntent.status },
        'error'
      )
      return { success: false, code: 'charge_failed', error: `Payment failed: ${paymentIntent.status}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // Only roll back when we know no money moved: before the charge, or a card error from Stripe
      // (declines are thrown for off-session confirms). An unknown error during/after the charge
      // (network, or completion failing after success) keeps the claim so nothing can charge again;
      // the webhook backstop completes it if the charge went through.
      const definitelyNotCharged = !chargeAttempted || isStripeCardError(error)
      if (definitelyNotCharged && claimed.length > 0) {
        try {
          await rollback(message)
        } catch (rollbackError) {
          logger.logPaymentProcessing(
            'payment-plan-early-payoff-rollback-failed',
            'CRITICAL: early payoff rollback failed - ADMIN INTERVENTION REQUIRED',
            { xeroInvoiceId, claimedIds: claimed.map(c => c.id), stagedPaymentId, paymentRecordId, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) },
            'error'
          )
        }
      } else if (claimed.length > 0) {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-outcome-unknown',
          'Early payoff outcome unknown; claim kept, webhook will complete if charged - check Stripe',
          { xeroInvoiceId, stagedPaymentId, paymentRecordId, error: message },
          'error'
        )
      }
      logger.logPaymentProcessing(
        'payment-plan-early-payoff-exception',
        'Exception processing early payoff',
        { xeroInvoiceId, error: message },
        'error'
      )
      return {
        success: false,
        code: isStripeCardError(error) ? 'charge_failed' : undefined,
        error: message
      }
    }
  }

  /**
   * Undo an early-payoff claim that didn't charge: claimed installments cancelled -> planned
   * (only the ones this attempt claimed, and only if still cancelled by it), the staged payoff
   * row -> cancelled (keeps the plan from showing 'failed'), the payment -> failed.
   */
  static async rollbackEarlyPayoff(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adminSupabase: { from: (table: string) => any },
    args: { xeroInvoiceId: string; claimedIds: string[]; stagedPaymentId: string | null; paymentRecordId: string | null; reason: string }
  ): Promise<void> {
    if (args.stagedPaymentId) {
      await adminSupabase
        .from('xero_payments')
        .update({ sync_status: 'cancelled', failure_reason: `Early payoff failed: ${args.reason}` })
        .eq('id', args.stagedPaymentId)
        .eq('sync_status', 'staged')
    }
    if (args.claimedIds.length > 0) {
      await adminSupabase
        .from('xero_payments')
        .update({ sync_status: 'planned', failure_reason: null })
        .in('id', args.claimedIds)
        .eq('sync_status', 'cancelled')
        .eq('failure_reason', EARLY_PAYOFF_SUPERSEDED_REASON)
    }
    if (args.paymentRecordId) {
      await adminSupabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('id', args.paymentRecordId)
        .eq('status', 'pending')
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
   * Uses the payment_plan_summary view (requires admin access)
   */
  static async getUserPaymentPlans(userId: string): Promise<PaymentPlanSummary[]> {
    try {
      // Use admin client since payment_plan_summary is restricted to service_role
      const adminSupabase = createAdminClient()

      // Query the payment_plan_summary view
      // View includes registration data directly (registration_name, registration_id)
      const { data: plans, error } = await adminSupabase
        .from('payment_plan_summary')
        .select('*')
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

      // Map plans with registration data (from view)
      const enrichedPlans = (plans || []).map((plan: PaymentPlanSummaryViewRow) => {
        const installmentAmount = plan.total_installments > 0
          ? plan.total_amount / plan.total_installments
          : 0

        return {
          id: plan.invoice_id,
          userRegistrationId: plan.registration_id || '',
          registrationName: plan.registration_name || 'Unknown',
          totalAmount: plan.total_amount,
          paidAmount: plan.paid_amount,
          remainingBalance: plan.total_amount - plan.paid_amount,
          installmentAmount,
          installmentsCount: plan.total_installments,
          installmentsPaid: plan.installments_paid,
          nextPaymentDate: plan.next_payment_date,
          status: plan.status,
          createdAt: null // payment_plan_summary doesn't include created_at
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
      // Note: contact_id doesn't exist as column, it's in staging_metadata
      const { data: allInvoices } = await supabase
        .from('xero_invoices')
        .select('id, staging_metadata, invoice_status')
        .eq('is_payment_plan', true)
        // A DRAFT invoice is an abandoned checkout, not a plan the member owes on
        .or('invoice_status.is.null,invoice_status.neq.DRAFT')

      if (!allInvoices || allInvoices.length === 0) {
        return false
      }

      // Filter to only this user's invoices
      const userInvoices = allInvoices.filter(inv =>
        inv.staging_metadata?.user_id === userId
      )

      if (userInvoices.length === 0) {
        return false
      }

      const invoiceIds = userInvoices.map(inv => inv.id)

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
      // Note: contact_id doesn't exist as column, it's in staging_metadata
      const { data: allInvoices } = await supabase
        .from('xero_invoices')
        .select('id, staging_metadata, invoice_status')
        .eq('is_payment_plan', true)
        // A DRAFT invoice is an abandoned checkout, not a plan the member owes on
        .or('invoice_status.is.null,invoice_status.neq.DRAFT')

      if (!allInvoices || allInvoices.length === 0) {
        return 0
      }

      // Filter to only this user's invoices
      const userInvoices = allInvoices.filter(inv =>
        inv.staging_metadata?.user_id === userId
      )

      if (userInvoices.length === 0) {
        return 0
      }

      const invoiceIds = userInvoices.map(inv => inv.id)

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
