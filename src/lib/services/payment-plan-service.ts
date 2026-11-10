import { createHash } from 'crypto'
import { getStripe } from '@/lib/stripe/server-client'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { centsToCents } from '@/types/currency'
import { PAYMENT_PLAN_INSTALLMENTS, INSTALLMENT_INTERVAL_DAYS } from './payment-plan-config'
import { toDateString } from '@/lib/date-utils'
import { isUserPaymentPlanEligible } from '@/lib/payment-plan-utils'
import { completeInstallmentCharge, installmentIdempotencyKey, LIVE_PAYOFF_STATUSES } from './installment-charge'

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

/**
 * Stripe idempotency key for an early payoff charge (#452). Derived from the payoff state, not
 * from per-request ids, so two submits for the same state (double click, two tabs) send the same
 * key and Stripe refuses to create a second charge. Includes the card so a retry with a new card
 * after a decline is not answered with the cached decline. `priorAttempts` (the number of rolled-back
 * payoff attempts on the invoice) changes after every rollback, so retrying with the same card
 * gets a fresh key: rollback restores the same planned rows, and reusing the old key with a new
 * metadata.paymentId would make Stripe reject the retry. Ids are hashed to stay under Stripe's
 * 255-char limit.
 */
export function earlyPayoffIdempotencyKey(
  xeroInvoiceId: string,
  paymentMethodId: string,
  amount: number,
  plannedPaymentIds: string[],
  priorAttempts: number
): string {
  const idsHash = createHash('sha256').update([...plannedPaymentIds].sort().join(',')).digest('hex').slice(0, 32)
  return `early-payoff:${xeroInvoiceId}:${paymentMethodId}:${amount}:${idsHash}:a${priorAttempts}`
}

/**
 * Result of one installment charge attempt (#461). `skipped` and `inFlight` are not failures: the
 * member wasn't declined, so the processor sends no failure email for them.
 */
export interface InstallmentChargeResult {
  success: boolean
  paymentId?: string
  error?: string
  /** Nothing was charged: the row was no longer planned, or an early payoff covers the invoice */
  skipped?: 'not_planned' | 'payoff_in_progress'
  /** A charge may be in flight (processing, or an unknown outcome); the webhook settles it */
  inFlight?: boolean
}

function isStripeCardError(error: unknown): boolean {
  return stripeErrorType(error) === 'StripeCardError'
}

/**
 * Stripe errors that mean no charge can have happened. Rate-limit errors are left out: the SDK
 * retries a dropped request with the same key, and a 429 on that retry can hide a first try that
 * did charge, so a rate-limited charge stays processing like any other unknown outcome.
 */
const STRIPE_ERRORS_WITH_NO_CHARGE = new Set([
  'StripeCardError',
  'StripeInvalidRequestError',
  'StripeAuthenticationError',
  'StripePermissionError'
])

function stripeErrorType(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const type = (error as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

function isStripeErrorWithNoCharge(error: unknown): boolean {
  const type = stripeErrorType(error)
  return type !== undefined && STRIPE_ERRORS_WITH_NO_CHARGE.has(type)
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
      return isUserPaymentPlanEligible(user)
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
   *
   * Race-safe (#461): the planned -> processing update only applies to a row that is still
   * planned, so two runs can't both charge it and a row an early payoff just cancelled is skipped.
   * An invoice with a live early payoff is skipped too. Each attempt has its own Stripe
   * idempotency key. The row goes back to planned only when no charge can have happened (before
   * the Stripe call, a card decline, or a non-processing failure status). A 'processing' intent, or
   * an error with an unknown outcome after the Stripe call, stays 'processing' for the webhook.
   */
  static async processPaymentPlanTransaction(
    xeroPaymentId: string
  ): Promise<InstallmentChargeResult> {
    const adminSupabase = createAdminClient()
    // The row's values before the claim, to put back if this attempt ends without charging.
    let claimedFrom: { attempt_count: number; last_attempt_at: string | null } | null = null
    // The attempt number this call claimed; updates below only touch the row while it is still on it.
    let claimedAttempt: number | null = null
    let chargeStarted = false

    const release = async (failureReason: string | null, restoreAttempt = false) => {
      const update: Record<string, unknown> = { sync_status: 'planned', failure_reason: failureReason }
      if (restoreAttempt && claimedFrom) {
        update.attempt_count = claimedFrom.attempt_count
        update.last_attempt_at = claimedFrom.last_attempt_at
        delete update.failure_reason
      }
      const { error } = await adminSupabase
        .from('xero_payments')
        .update(update)
        .eq('id', xeroPaymentId)
        .eq('sync_status', 'processing')
        // A slow decline must not release a newer attempt claimed after a webhook released this one.
        .eq('attempt_count', claimedAttempt)
      if (error) {
        logger.logPaymentProcessing(
          'payment-plan-installment-release-error',
          'Failed to put installment back to planned',
          { xeroPaymentId, error: error.message },
          'error'
        )
      }
    }

    try {
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

      if (xeroPayment.sync_status !== 'planned') {
        return { success: false, skipped: 'not_planned', error: `Installment is ${xeroPayment.sync_status}, not planned` }
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

      // Claim the installment: only a row that is still planned moves to processing.
      const attempt = (xeroPayment.attempt_count ?? 0) + 1
      const { data: claimedRows, error: claimError } = await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'processing',
          last_attempt_at: new Date().toISOString(),
          attempt_count: attempt
        })
        .eq('id', xeroPaymentId)
        .eq('sync_status', 'planned')
        .select('id')

      if (claimError) {
        return { success: false, error: `Failed to claim installment: ${claimError.message}` }
      }
      if (!claimedRows || claimedRows.length === 0) {
        return { success: false, skipped: 'not_planned', error: 'Installment was no longer planned' }
      }
      claimedFrom = { attempt_count: xeroPayment.attempt_count ?? 0, last_attempt_at: xeroPayment.last_attempt_at ?? null }
      claimedAttempt = attempt

      // Skip an invoice that an early payoff is paying off. The payoff stages its own row first,
      // cancels the rows it read, then stops if any installment is still planned or processing.
      // Each side writes its claim before checking for the other's, so at least one of the two
      // sees the other and at most one charges.
      const { data: payoffRows, error: payoffError } = await adminSupabase
        .from('xero_payments')
        .select('id')
        .eq('xero_invoice_id', xeroPayment.xero_invoice_id)
        .eq('payment_type', 'full')
        .eq('staging_metadata->>early_payoff', 'true')
        .in('sync_status', LIVE_PAYOFF_STATUSES)

      if (payoffError) {
        await release(null, true)
        return { success: false, error: `Failed to check for an early payoff: ${payoffError.message}` }
      }
      if (payoffRows && payoffRows.length > 0) {
        await release(null, true)
        logger.logPaymentProcessing(
          'payment-plan-installment-skipped-payoff',
          'Skipping installment: an early payoff is in progress or done for this invoice',
          { xeroPaymentId, xeroInvoiceId: xeroPayment.xero_invoice_id, payoffRowIds: payoffRows.map((r: { id: string }) => r.id) },
          'info'
        )
        return { success: false, skipped: 'payoff_in_progress', error: 'An early payoff is in progress for this plan' }
      }

      logger.logPaymentProcessing(
        'payment-plan-installment-processing',
        'Processing payment plan installment',
        {
          xeroPaymentId,
          installmentNumber: xeroPayment.installment_number,
          amount: xeroPayment.amount_paid,
          attemptCount: attempt
        },
        'info'
      )

      // Create Stripe payment intent
      const registrationName = userReg.registration?.name || 'Registration'
      const seasonName = userReg.registration?.season?.name || ''

      chargeStarted = true
      const paymentIntent = await getStripe().paymentIntents.create(
        {
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
            attemptNumber: attempt.toString(),
            userRegistrationId: xeroPayment.staging_metadata?.user_registration_id || '',
            purpose: 'payment_plan_installment'
          },
          description: `Payment Plan Installment ${xeroPayment.installment_number}/4 - ${registrationName} ${seasonName}`
        },
        { idempotencyKey: installmentIdempotencyKey(xeroPaymentId, attempt) }
      )

      // Record this attempt's intent on the row, so the webhook can tell which attempt an event is for
      await adminSupabase
        .from('xero_payments')
        .update({
          staging_metadata: {
            ...(xeroPayment.staging_metadata || {}),
            stripe_payment_intent_id: paymentIntent.id
          }
        })
        .eq('id', xeroPaymentId)
        .eq('sync_status', 'processing')
        .eq('attempt_count', attempt)

      if (paymentIntent.status === 'succeeded') {
        // Shared with the webhook: whichever gets there first records the payment, once (#461).
        const completion = await completeInstallmentCharge(adminSupabase, xeroPaymentId, paymentIntent, user.id)
        const paymentId = completion.status === 'completed' ? completion.paymentId ?? undefined : undefined

        if (completion.status === 'not_found' || completion.status === 'not_processing') {
          logger.logPaymentProcessing(
            'payment-plan-installment-unsettled',
            'CRITICAL: installment charged but its row could not be marked paid - ADMIN INTERVENTION REQUIRED',
            { xeroPaymentId, paymentIntentId: paymentIntent.id, completion },
            'error'
          )
        }

        logger.logPaymentProcessing(
          'payment-plan-installment-success',
          'Successfully processed payment plan installment',
          {
            xeroPaymentId,
            paymentId,
            installmentNumber: xeroPayment.installment_number,
            completion: completion.status
          },
          'info'
        )

        return { success: true, paymentId }
      }

      if (paymentIntent.status === 'processing') {
        // Still settling (e.g. a bank debit). The webhook marks it paid or puts it back to planned;
        // putting it back now would let the next run charge it again.
        logger.logPaymentProcessing(
          'payment-plan-installment-in-flight',
          'Installment charge is processing; the webhook will settle it',
          { xeroPaymentId, paymentIntentId: paymentIntent.id, attemptCount: attempt },
          'info'
        )
        return { success: false, inFlight: true, error: 'Payment is processing' }
      }

      // requires_action / requires_payment_method etc.: no money moved, so retry later
      const failureReason = `Payment status: ${paymentIntent.status}`
      await release(failureReason)

      logger.logPaymentProcessing(
        'payment-plan-installment-failed',
        'Payment plan installment failed',
        {
          xeroPaymentId,
          installmentNumber: xeroPayment.installment_number,
          status: paymentIntent.status,
          attemptCount: attempt
        },
        'warn'
      )

      return { success: false, error: failureReason }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Unknown error'

      if (claimedFrom && chargeStarted && !isStripeErrorWithNoCharge(error)) {
        // Connection, API, idempotency and rate-limit errors may or may not have charged (or a DB
        // error after the charge). Leave the row processing so nothing charges it again; the
        // webhook settles it if Stripe has the intent.
        logger.logPaymentProcessing(
          'payment-plan-installment-outcome-unknown',
          'CRITICAL: installment charge outcome unknown; left in processing - ADMIN REVIEW REQUIRED',
          {
            xeroPaymentId,
            error: failureReason,
            idempotencyKey: installmentIdempotencyKey(xeroPaymentId, (claimedFrom.attempt_count ?? 0) + 1),
            recovery: 'Search Stripe for a PaymentIntent with metadata.xeroPaymentId = this id. If one succeeded and the webhook did not settle the row, set it to pending with that intent. If none exists, set the row back to planned.'
          },
          'error'
        )
        return { success: false, inFlight: true, error: failureReason }
      }

      // No charge can have happened (failed before the Stripe call, card decline, or a Stripe 4xx
      // that means the request was rejected before a charge)
      if (claimedFrom) await release(failureReason)

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
    xeroInvoiceId: string,
    userId: string
  ): Promise<{ success: boolean; paymentId?: string; totalPaid?: number; error?: string }> {
    // Set once this attempt has cancelled installments / created records, so a declined charge
    // can put them back (#452).
    let rollbackState: { cancelledIds: string[]; stagedPaymentId?: string; paymentId?: string } | null = null
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

      // Get user info
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
      const registration = Array.isArray(userReg?.registration) ? userReg?.registration[0] : userReg?.registration
      const registrationName = registration?.name || 'Registration'
      const season = Array.isArray(registration?.season) ? registration?.season[0] : registration?.season
      const seasonName = season?.name || ''

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

      /**
       * Early Payoff Flow (Multi-Step Process)
       *
       * Note: We don't use a database transaction here because:
       * 1. Supabase client doesn't natively support transactions across multiple operations
       * 2. Database operations are extremely reliable - failures are rare
       * 3. If failures occur, they indicate system-wide issues requiring admin intervention anyway
       * 4. Critical error logs provide clear recovery instructions for admins
       *
       * Steps:
       * 1. Create staged payment for full balance (the unique index makes this the claim)
       * 2. Cancel planned payments (set sync_status='cancelled')
       * 3. Create payment record
       * 4. Charge Stripe (webhook completes the flow)
       *
       * Each step has defensive error handling with critical logging for admin recovery.
       */

      // Rolled-back payoff attempts so far (staged rows set to 'cancelled' by rollbackEarlyPayoff);
      // part of the idempotency key so a retry after a decline isn't rejected by Stripe.
      const { data: priorAttemptRows, error: priorAttemptsError } = await adminSupabase
        .from('xero_payments')
        .select('id')
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('payment_type', 'full')
        .eq('sync_status', 'cancelled')
        .eq('staging_metadata->>early_payoff', 'true')
      if (priorAttemptsError) {
        return { success: false, error: 'Error checking previous payoff attempts' }
      }
      const priorAttempts = priorAttemptRows?.length ?? 0

      // Step 1: Create staged xero_payment for the payoff amount. This comes first because the
      // unique index (one live early payoff per invoice, #466) makes the insert the claim: a
      // request that loses it stops here with the plan's installments untouched.
      const { data: stagedPayment, error: stagedPaymentError } = await adminSupabase
        .from('xero_payments')
        .insert({
          xero_invoice_id: xeroInvoiceId,
          tenant_id: plannedPayments[0].tenant_id,
          xero_payment_id: null, // Will be populated when synced to Xero
          payment_method: 'stripe',
          amount_paid: remainingBalance,
          sync_status: 'staged',
          payment_type: 'full', // Single payment for remaining balance
          staged_at: new Date().toISOString(),
          staging_metadata: {
            user_id: userId,
            user_registration_id: plannedPayments[0].staging_metadata?.user_registration_id || '',
            early_payoff: true,
            original_plan_amount: remainingBalance,
            cancelled_payments_count: plannedPayments.length
          }
        })
        .select()
        .single()

      if (stagedPaymentError?.code === '23505') {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-already-in-progress',
          'Early payoff already in progress for this invoice (a live payoff row exists)',
          { xeroInvoiceId, userId },
          'warn'
        )
        return { success: false, error: 'An early payoff is already in progress for this plan' }
      }

      if (stagedPaymentError || !stagedPayment) {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-staged-error',
          'Failed to create staged early payoff payment',
          { xeroInvoiceId, userId, remainingBalance, error: stagedPaymentError?.message },
          'error'
        )
        return { success: false, error: 'Failed to create staged payment record' }
      }
      rollbackState = { cancelledIds: [], stagedPaymentId: stagedPayment.id }

      // Step 2: Cancel the planned payments this payoff covers (mark as superseded). Only rows
      // still planned are cancelled; the count is checked below (#461).
      const plannedIds = plannedPayments.map(p => p.id)
      const { data: cancelledRows, error: cancelError } = await adminSupabase
        .from('xero_payments')
        .update({
          sync_status: 'cancelled',
          failure_reason: 'Superseded by early payoff payment'
        })
        .in('id', plannedIds)
        .eq('sync_status', 'planned')
        .select('id')

      if (cancelError) {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-cancel-error',
          'Failed to cancel planned payments',
          { xeroInvoiceId, error: cancelError.message },
          'error'
        )
        // Nothing was charged: release the claim so a retry can stage a new payoff.
        await PaymentPlanService.rollbackEarlyPayoff(adminSupabase, rollbackState, `Early payoff aborted: ${cancelError.message}`)
        return { success: false, error: 'Failed to cancel planned payments' }
      }
      rollbackState.cancelledIds = (cancelledRows || []).map((r: { id: string }) => r.id)

      if (rollbackState.cancelledIds.length !== plannedIds.length) {
        // An installment charge claimed one of the rows between the read and the cancel (#461), so
        // the balance read above is no longer right. Put everything back and let the member retry.
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-plan-changed',
          'Early payoff stopped: an installment was claimed by a charge while the payoff started',
          { xeroInvoiceId, plannedIds, cancelledIds: rollbackState.cancelledIds },
          'warn'
        )
        await PaymentPlanService.rollbackEarlyPayoff(adminSupabase, rollbackState, 'Early payoff aborted: an installment was being charged')
        return { success: false, error: 'An installment payment is being processed right now. Please try again in a few minutes.' }
      }

      // Every unpaid installment must be covered by this payoff. One that a charge claimed before
      // the balance was read isn't in it, and the charge path may since have put it back to
      // planned (it skips invoices with a live payoff). Once this payoff is live it would be
      // skipped for good, so stop if any installment is still planned or processing (#461). This
      // runs after the staged insert and the cancel, so a charge claiming a row after this point
      // can't happen (all rows this payoff read are cancelled) and one claiming it earlier is seen.
      const { data: uncoveredRows, error: uncoveredError } = await adminSupabase
        .from('xero_payments')
        .select('id')
        .eq('xero_invoice_id', xeroInvoiceId)
        .eq('payment_type', 'installment')
        .in('sync_status', ['planned', 'processing'])
      if (uncoveredError || (uncoveredRows && uncoveredRows.length > 0)) {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-installment-in-flight',
          'Early payoff stopped: an installment outside the payoff is still unpaid or being charged',
          { xeroInvoiceId, uncoveredIds: (uncoveredRows || []).map((r: { id: string }) => r.id), error: uncoveredError?.message },
          'warn'
        )
        await PaymentPlanService.rollbackEarlyPayoff(adminSupabase, rollbackState, 'Early payoff aborted: an installment was being charged')
        return {
          success: false,
          error: uncoveredError
            ? 'Error checking installment status'
            : 'An installment payment is being processed right now. Please try again in a few minutes.'
        }
      }

      // Step 3: Create payment record BEFORE charging (webhook will update to completed)
      const { data: paymentRecord, error: paymentRecordError } = await adminSupabase
        .from('payments')
        .insert({
          user_id: userId,
          total_amount: centsToCents(remainingBalance),
          final_amount: centsToCents(remainingBalance),
          status: 'pending', // Webhook will update to completed
          payment_method: 'stripe'
        })
        .select()
        .single()

      if (paymentRecordError || !paymentRecord) {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-payment-error',
          'CRITICAL: Staged payment created but payment record failed - ADMIN INTERVENTION REQUIRED',
          {
            xeroInvoiceId,
            userId,
            stagedPaymentId: stagedPayment.id,
            remainingBalance,
            error: paymentRecordError?.message,
            recovery: 'Admin must manually create payment record or delete staged payment and restore cancelled payments'
          },
          'error'
        )
        return { success: false, error: 'Failed to create payment record' }
      }
      rollbackState.paymentId = paymentRecord.id

      // Step 4: Charge Stripe (webhook will handle completion)
      const paymentIntent = await getStripe().paymentIntents.create({
        amount: centsToCents(remainingBalance),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id,
        confirm: true,
        off_session: true,
        receipt_email: user.email,
        metadata: {
          userId: userId,
          xeroStagingRecordId: xeroInvoiceId,
          xeroStagedPaymentId: stagedPayment.id, // Webhook finds the staged payoff row by this exact id (#466)
          userRegistrationId: plannedPayments[0].staging_metadata?.user_registration_id || '',
          purpose: 'payment_plan_early_payoff',
          paymentId: paymentRecord.id,
          registrationName: registrationName,
          seasonName: seasonName
        },
        description: `Early Payoff - ${registrationName} ${seasonName}`
      }, {
        // Same payoff state (invoice, card, amount, set of planned rows) -> same key, so a
        // double-submit is deduplicated by Stripe instead of charging twice (#452).
        idempotencyKey: earlyPayoffIdempotencyKey(
          xeroInvoiceId,
          user.stripe_payment_method_id,
          remainingBalance,
          plannedPayments.map(p => p.id),
          priorAttempts
        )
      })

      // Update payment record with stripe_payment_intent_id
      await adminSupabase
        .from('payments')
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .eq('id', paymentRecord.id)

      if (paymentIntent.status !== 'succeeded') {
        logger.logPaymentProcessing(
          'payment-plan-early-payoff-charge-failed',
          'Stripe charge failed for early payoff',
          { xeroInvoiceId, paymentIntentId: paymentIntent.id, status: paymentIntent.status },
          'error'
        )
        // requires_action / requires_payment_method etc.: the customer can't complete 3DS
        // off-session, so cancel the intent and restore the plan. 'processing' may still succeed
        // (the webhook completes it), so leave that one alone.
        if (paymentIntent.status !== 'processing') {
          try {
            await getStripe().paymentIntents.cancel(paymentIntent.id)
          } catch {
            // best effort; an uncancelled requires_action intent never captures funds
          }
          await PaymentPlanService.rollbackEarlyPayoff(adminSupabase, rollbackState, `Early payoff failed: ${paymentIntent.status}`)
        }
        return {
          success: false,
          error: `Payment failed: ${paymentIntent.status}`
        }
      }

      // Webhook will handle the rest: update payment to completed, xero_payment to pending
      logger.logPaymentProcessing(
        'payment-plan-early-payoff-success',
        'Successfully charged early payoff, webhook will complete processing',
        {
          xeroInvoiceId,
          paymentId: paymentRecord.id,
          paymentIntentId: paymentIntent.id,
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
      // A declined card (StripeCardError) means no charge happened: restore the plan. Any other
      // error after the charge started (network, idempotency conflict from a concurrent
      // double-submit) has an unknown or someone-else's outcome, so leave the records alone.
      if (rollbackState && isStripeCardError(error)) {
        try {
          await PaymentPlanService.rollbackEarlyPayoff(
            createAdminClient(),
            rollbackState,
            `Early payoff declined: ${error instanceof Error ? error.message : String(error)}`
          )
        } catch (rollbackError) {
          logger.logPaymentProcessing(
            'payment-plan-early-payoff-rollback-error',
            'CRITICAL: early payoff declined but rollback failed - ADMIN INTERVENTION REQUIRED',
            { xeroInvoiceId, rollbackState, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) },
            'error'
          )
        }
      }
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
   * Undo an early payoff attempt whose charge did not happen (#452): installments this attempt
   * cancelled go back to 'planned', the staged 'full' row is cancelled (not 'failed', which would
   * flip payment_plan_summary.status to failed) with the reason recorded, and the payment record
   * is marked failed.
   */
  static async rollbackEarlyPayoff(
    adminSupabase: ReturnType<typeof createAdminClient>,
    state: { cancelledIds: string[]; stagedPaymentId?: string; paymentId?: string },
    reason: string
  ): Promise<void> {
    if (state.cancelledIds.length > 0) {
      const { error } = await adminSupabase
        .from('xero_payments')
        .update({ sync_status: 'planned', failure_reason: null })
        .in('id', state.cancelledIds)
        .eq('sync_status', 'cancelled')
        .eq('failure_reason', 'Superseded by early payoff payment')
      if (error) throw new Error(`Failed to restore installments: ${error.message}`)
    }
    if (state.stagedPaymentId) {
      const { error } = await adminSupabase
        .from('xero_payments')
        .update({ sync_status: 'cancelled', failure_reason: reason })
        .eq('id', state.stagedPaymentId)
        .eq('sync_status', 'staged')
      if (error) throw new Error(`Failed to cancel staged payoff: ${error.message}`)
    }
    if (state.paymentId) {
      const { error } = await adminSupabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('id', state.paymentId)
        .eq('status', 'pending')
      if (error) throw new Error(`Failed to mark payment failed: ${error.message}`)
    }
    logger.logPaymentProcessing(
      'payment-plan-early-payoff-rolled-back',
      'Early payoff charge did not go through; installments restored',
      { ...state, reason },
      'warn'
    )
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
