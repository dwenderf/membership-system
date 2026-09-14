import { NextRequest, NextResponse } from 'next/server'

import Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/server-client'
import { createAdminClient } from '@/lib/supabase/server'
import { calculateMembershipStartDate, calculateMembershipEndDate } from '@/lib/membership-utils'
import { deleteXeroDraftInvoice } from '@/lib/xero/invoices'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { logger } from '@/lib/logging/logger'
import { stageRefundNotificationEmail } from '@/lib/email/refund-notification'
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

type UserMembershipRow = Database['public']['Tables']['user_memberships']['Row']
type UserRegistrationRow = Database['public']['Tables']['user_registrations']['Row']

// Force import server config

/**
 * STRIPE WEBHOOK HANDLER - CRITICAL PAYMENT PROCESSING
 *
 * This webhook processes Stripe events and is critical for payment completion flow.
 *
 * IMPORTANT: When adding new payment_intent.succeeded handlers, you MUST follow this pattern:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ REQUIRED STEPS FOR ALL payment_intent.succeeded HANDLERS                        │
 * ├─────────────────────────────────────────────────────────────────────────────────┤
 * │ 1. ✅ Get Stripe charge ID and fees                                             │
 * │    const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)
 * │                                                                                  │
 * │ 2. ✅ Update payment record with ALL required fields                            │
 * │    await supabase.from('payments').update({                                     │
 * │      status: 'completed',                                                       │
 * │      completed_at: new Date().toISOString(),                                    │
 * │      stripe_fee_amount: stripeFeeAmount,  // ⚠️ REQUIRED for accounting        │
 * │      stripe_charge_id: chargeId           // ⚠️ REQUIRED for Xero reconciliation│
 * │    })                                                                            │
 * │                                                                                  │
 * │ 3. ✅ Pass charge_id to payment completion processor                            │
 * │    await paymentProcessor.processPaymentCompletion({                            │
 * │      ...otherFields,                                                            │
 * │      metadata: {                                                                │
 * │        payment_intent_id: paymentIntent.id,                                     │
 * │        charge_id: chargeId || undefined,  // ⚠️ REQUIRED for Xero sync         │
 * │        xero_staging_record_id: paymentIntent.metadata?.xeroStagingRecordId      │
 * │      }                                                                           │
 * │    })                                                                            │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS IS CRITICAL:
 *
 * - stripe_charge_id is used as the "Payment Reference" in Xero
 * - Without it, Xero payments use invoice number for BOTH Reference and Payment Reference
 * - This makes bank reconciliation extremely difficult in Xero
 * - Missing these fields causes accounting discrepancies
 *
 * REFERENCE IMPLEMENTATIONS:
 * - See handleMembershipPayment() for regular membership pattern (lines ~97-293)
 * - See handleRegistrationPayment() for regular registration pattern (lines ~296-492)
 * - See alternate payment handler for off-session payment pattern (lines ~1261-1340)
 * - See waitlist payment handler for another off-session payment pattern (lines ~1188-1258)
 *
 * XERO PAYMENT FLOW:
 * 1. Webhook captures stripe_charge_id
 * 2. Payment completion processor updates xero_payments.staging_metadata
 * 3. Batch sync reads charge_id from staging_metadata
 * 4. Xero payment created with Reference: INV-XXX, Payment Reference: ch_XXXXX
 * 5. Bank reconciliation in Xero matches on Payment Reference (Stripe charge ID)
 *
 * ⚠️ FAILURE TO FOLLOW THIS PATTERN WILL BREAK XERO RECONCILIATION ⚠️
 */

// Helper function to get actual Stripe fees and charge ID from charge
async function getStripeFeeAmountAndChargeId(paymentIntent: Stripe.PaymentIntent): Promise<{ fee: number; chargeId: string | null }> {
  try {
    // Retrieve the payment intent with expanded charge and balance transaction to get actual fees
    const expandedPaymentIntent = await getStripe().paymentIntents.retrieve(paymentIntent.id, {
      expand: ['latest_charge', 'latest_charge.balance_transaction']
    })

    if (expandedPaymentIntent.latest_charge &&
      typeof expandedPaymentIntent.latest_charge === 'object' &&
      'id' in expandedPaymentIntent.latest_charge) {

      const chargeId = expandedPaymentIntent.latest_charge.id

      // Check if balance transaction is available in the expanded charge
      if ('balance_transaction' in expandedPaymentIntent.latest_charge &&
        expandedPaymentIntent.latest_charge.balance_transaction &&
        typeof expandedPaymentIntent.latest_charge.balance_transaction === 'object' &&
        'fee' in expandedPaymentIntent.latest_charge.balance_transaction) {

        const stripeFeeAmount = expandedPaymentIntent.latest_charge.balance_transaction.fee
        logger.logPaymentProcessing('stripe-fee-retrieved', `Retrieved actual Stripe fee from balance transaction: $${(stripeFeeAmount / 100).toFixed(2)} for payment ${paymentIntent.id}`, { paymentIntentId: paymentIntent.id, chargeId, stripeFeeAmount }, 'debug')
        return { fee: stripeFeeAmount, chargeId: chargeId as string }
      }

      // Fallback: retrieve the charge directly to get the fee
      const charge = await getStripe().charges.retrieve(chargeId as string, {
        expand: ['balance_transaction']
      })

      if (charge.balance_transaction &&
        typeof charge.balance_transaction === 'object' &&
        'fee' in charge.balance_transaction &&
        typeof charge.balance_transaction.fee === 'number') {
        const stripeFeeAmount = charge.balance_transaction.fee
        logger.logPaymentProcessing('stripe-fee-retrieved', `Retrieved actual Stripe fee from charge balance transaction: $${(stripeFeeAmount / 100).toFixed(2)} for payment ${paymentIntent.id}`, { paymentIntentId: paymentIntent.id, chargeId, stripeFeeAmount }, 'debug')
        return { fee: stripeFeeAmount, chargeId: chargeId as string }
      } else {
        logger.logPaymentProcessing('stripe-fee-unavailable', `Fee not available in balance transaction, setting fee to 0 for payment ${paymentIntent.id}`, { paymentIntentId: paymentIntent.id, chargeId }, 'warn')
        return { fee: 0, chargeId: chargeId as string }
      }
    } else {
      logger.logPaymentProcessing('stripe-charge-unavailable', `Charge not available, setting fee to 0 for payment ${paymentIntent.id}`, { paymentIntentId: paymentIntent.id }, 'warn')
      return { fee: 0, chargeId: null }
    }
  } catch (feeError) {
    // Fallback to 0 if there's an error retrieving the balance transaction
    logger.logPaymentProcessing('stripe-fee-retrieval-error', 'Error retrieving Stripe fees; recording fee as $0', { paymentIntentId: paymentIntent.id, error: feeError instanceof Error ? feeError.message : String(feeError) }, 'error')
    return { fee: 0, chargeId: null }
  }
}

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

/**
 * Update payment plan installment statuses
 * Sets first installment to 'pending' and remaining to 'planned'
 * Only updates payments that are still in 'staged' status (idempotent)
 * Flexible - works with any number of installments
 */
async function updatePaymentPlanStatuses(
  supabase: ReturnType<typeof createAdminClient>,
  xeroInvoiceId: string
): Promise<void> {
  const { data: allPayments } = await supabase
    .from('xero_payments')
    .select('id, installment_number')
    .eq('xero_invoice_id', xeroInvoiceId)
    .eq('payment_type', 'installment')
    .order('installment_number')

  if (!allPayments || allPayments.length === 0) {
    logger.logPaymentProcessing('payment-plan-installments-missing', 'No installment payments found for payment plan', { xeroInvoiceId }, 'error')
    return
  }

  // Update first payment to 'pending' (only if still staged)
  await supabase
    .from('xero_payments')
    .update({ sync_status: 'pending' })
    .eq('id', allPayments[0].id)
    .eq('sync_status', 'staged')

  // Update remaining payments to 'planned' (only if still staged)
  if (allPayments.length > 1) {
    const plannedPaymentIds = allPayments.slice(1).map(p => p.id)
    await supabase
      .from('xero_payments')
      .update({ sync_status: 'planned' })
      .in('id', plannedPaymentIds)
      .eq('sync_status', 'staged')
  }

  logger.logPaymentProcessing('payment-plan-statuses-updated', 'Updated xero_payments installment statuses', { xeroInvoiceId, installmentCount: allPayments.length }, 'info')
}

// Handle membership payment processing
async function handleMembershipPayment(supabase: SupabaseClient, adminSupabase: SupabaseClient, paymentIntent: Stripe.PaymentIntent, userId: string, membershipId: string, durationMonths: number) {
  // Check if user membership already exists (avoid duplicates)
  const { data: existingMembership } = await supabase
    .from('user_memberships')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

  let membershipRecord: UserMembershipRow

  if (existingMembership) {
    logger.logPaymentProcessing('membership-already-exists', 'User membership already exists for payment intent', { paymentIntentId: paymentIntent.id }, 'debug')

    // Update payment status from 'pending' to 'paid' if needed
    if (existingMembership.payment_status === 'pending') {
      logger.logPaymentProcessing('membership-status-updating', 'Updating existing membership payment status from pending to paid', { paymentIntentId: paymentIntent.id }, 'debug')
      const { data: updatedMembership, error: updateError } = await supabase
        .from('user_memberships')
        .update({
          payment_status: 'paid',
          amount_paid: paymentIntent.amount,
          purchased_at: new Date().toISOString()
        })
        .eq('id', existingMembership.id)
        .select()
        .single()

      if (updateError) {
        logger.logPaymentProcessing('membership-status-update-error', 'Error updating membership payment status', { paymentIntentId: paymentIntent.id, error: updateError.message }, 'error')
        throw new Error('Failed to update membership payment status')
      }

      membershipRecord = updatedMembership
    } else {
      membershipRecord = existingMembership
    }
  } else {
    // Calculate dates - need to determine if this extends an existing membership
    const { data: userMemberships } = await supabase
      .from('user_memberships')
      .select('*')
      .eq('user_id', userId)
      .eq('membership_id', membershipId)
      .gte('valid_until', new Date().toISOString().split('T')[0])
      .order('valid_until', { ascending: false })

    // Use expected dates from payment intent metadata if available, otherwise calculate them
    let startDate: Date, endDate: Date
    
    if (paymentIntent.metadata.expectedValidFrom && paymentIntent.metadata.expectedValidUntil) {
      // Use the dates that were shown to the user on the frontend
      startDate = new Date(paymentIntent.metadata.expectedValidFrom)
      endDate = new Date(paymentIntent.metadata.expectedValidUntil)
    } else {
      // Fallback to calculation (for backward compatibility with old payment intents)
      startDate = calculateMembershipStartDate(membershipId, userMemberships || [])
      endDate = calculateMembershipEndDate(startDate, durationMonths)
    }

    // Create user membership record (handle duplicate gracefully)
    try {
      const { data: newMembership, error: membershipError } = await supabase
        .from('user_memberships')
        .insert({
          user_id: userId,
          membership_id: membershipId,
          valid_from: startDate.toISOString().split('T')[0],
          valid_until: endDate.toISOString().split('T')[0],
          months_purchased: durationMonths,
          payment_status: 'paid',
          stripe_payment_intent_id: paymentIntent.id,
          amount_paid: paymentIntent.amount,
          purchased_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (membershipError) {
        if (membershipError.code === '23505') { // Duplicate key error
          logger.logPaymentProcessing('membership-duplicate-key', 'Membership already exists for payment intent, fetching existing record', { paymentIntentId: paymentIntent.id }, 'debug')
          const { data: existingMembership, error: fetchError } = await supabase
            .from('user_memberships')
            .select('*')
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .single()

          if (fetchError || !existingMembership) {
            logger.logPaymentProcessing('membership-fetch-error', 'Error fetching existing membership', { paymentIntentId: paymentIntent.id, error: fetchError?.message }, 'error')
            throw new Error('Failed to fetch existing membership')
          }

          membershipRecord = existingMembership
        } else {
          logger.logPaymentProcessing('membership-create-error', 'Error creating user membership', { paymentIntentId: paymentIntent.id, error: membershipError.message }, 'error')
          throw new Error('Failed to create membership')
        }
      } else {
        membershipRecord = newMembership
      }
    } catch {
      throw new Error('Failed to create or fetch membership')
    }
  }

  // Get actual Stripe fees and charge ID from the charge
  const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)

  // Update payment record
  const { data: updatedPayment, error: paymentUpdateError } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stripe_fee_amount: stripeFeeAmount,
      stripe_charge_id: chargeId
    })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .select()

  if (paymentUpdateError) {
    logger.logPaymentProcessing('membership-payment-record-update-failed', 'Error updating membership payment record', { paymentIntentId: paymentIntent.id, error: paymentUpdateError.message }, 'error')
    throw new Error('Failed to update payment record')
  } else if (updatedPayment && updatedPayment.length > 0) {
    logger.logPaymentProcessing('membership-payment-record-updated', `Updated membership payment record to completed: ${updatedPayment[0].id} (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`, { paymentIntentId: paymentIntent.id, paymentId: updatedPayment[0].id, stripeFeeAmount }, 'info')

    // Update user_memberships record with payment_id
    const { error: membershipUpdateError } = await adminSupabase
      .from('user_memberships')
      .update({ payment_id: updatedPayment[0].id })
      .eq('id', membershipRecord.id)

    if (membershipUpdateError) {
      logger.logPaymentProcessing('membership-payment-id-link-failed', 'Error updating membership record with payment_id', { paymentIntentId: paymentIntent.id, paymentId: updatedPayment[0].id, error: membershipUpdateError.message }, 'error')
    }
  } else {
    logger.logPaymentProcessing('membership-payment-record-not-found', `No payment record found for payment intent: ${paymentIntent.id}`, { paymentIntentId: paymentIntent.id }, 'error')
    throw new Error('Payment record not found - checkout process may have failed')
  }

  // Xero integration is now handled entirely by the payment completion processor
  // This ensures consistent handling of staging records, emails, and batch sync

  // Trigger payment completion processor for emails and post-processing
  try {
    await paymentProcessor.processPaymentCompletion({
      event_type: 'user_memberships',
      record_id: membershipRecord.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_membership',
      timestamp: new Date().toISOString(),
      metadata: {
        payment_intent_id: paymentIntent.id,
        charge_id: chargeId || undefined,
        xero_staging_record_id: paymentIntent.metadata?.xeroStagingRecordId || undefined
      }
    })
  } catch (processorError) {
    logger.logPaymentProcessing('payment-completion-processor-failed', 'Failed to trigger payment completion processor for membership', {
      paymentIntentId: paymentIntent.id,
      error: processorError instanceof Error ? processorError.message : String(processorError),
      stack: processorError instanceof Error ? processorError.stack : undefined
    }, 'error')
    // Don't fail the webhook - membership was created successfully
  }
}

// Handle registration payment processing
async function handleRegistrationPayment(supabase: SupabaseClient, paymentIntent: Stripe.PaymentIntent, userId: string, registrationId: string) {
  // Note: Webhook doesn't have access to categoryId, so we'll need to get it from the registration
  // For now, let's keep the direct database update in webhooks since they're backup/redundancy

  let userRegistration: UserRegistrationRow

  // First, check if registration already exists and is paid
  const { data: existingPaidRegistration } = await supabase
    .from('user_registrations')
    .select('*')
    .eq('user_id', userId)
    .eq('registration_id', registrationId)
    .eq('payment_status', 'paid')
    .single()

  if (existingPaidRegistration) {
    logger.logPaymentProcessing('registration-already-paid', 'Registration already paid, using existing record', { registrationId: existingPaidRegistration.id }, 'debug')
    userRegistration = existingPaidRegistration
  } else {
    // Update user registration record from awaiting_payment/processing to paid
    const { data: updatedRegistration, error: registrationError } = await supabase
      .from('user_registrations')
      .update({
        payment_status: 'paid',
        registered_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntent.id,
      })
      .eq('user_id', userId)
      .eq('registration_id', registrationId)
      .in('payment_status', ['awaiting_payment', 'processing'])
      .select()
      .single()

    if (registrationError || !updatedRegistration) {
      // Try to find any registration record for debugging
      const { data: allRegistrations } = await supabase
        .from('user_registrations')
        .select('*')
        .eq('user_id', userId)
        .eq('registration_id', registrationId)

      logger.logPaymentProcessing('registration-update-failed', 'Error updating user registration', { userId, registrationId, error: registrationError?.message, allRegistrationsFound: allRegistrations }, 'error')
      throw new Error('Failed to update registration')
    }

    userRegistration = updatedRegistration
  }

  // Note: Discount usage is now tracked via discount_usage_computed view
  // which derives data from xero_invoice_line_items

  // Get actual Stripe fees and charge ID from the charge
  const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)

  // Update payment record
  const { data: updatedPayment, error: paymentUpdateError } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stripe_fee_amount: stripeFeeAmount,
      stripe_charge_id: chargeId
    })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .select()

  if (paymentUpdateError) {
    logger.logPaymentProcessing('registration-payment-record-update-failed', 'Error updating payment record', { paymentIntentId: paymentIntent.id, error: paymentUpdateError.message }, 'error')
    throw new Error('Failed to update payment record')
  } else if (updatedPayment && updatedPayment.length > 0) {
    logger.logPaymentProcessing('registration-payment-record-updated', `Updated payment record to completed: ${updatedPayment[0].id} (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`, { paymentIntentId: paymentIntent.id, paymentId: updatedPayment[0].id, stripeFeeAmount }, 'info')

    // Update user_registrations record with payment_id
    const { error: registrationUpdateError } = await supabase
      .from('user_registrations')
      .update({ payment_id: updatedPayment[0].id })
      .eq('id', userRegistration.id)

    if (registrationUpdateError) {
      logger.logPaymentProcessing('registration-payment-id-link-failed', 'Error updating registration record with payment_id', { paymentIntentId: paymentIntent.id, paymentId: updatedPayment[0].id, error: registrationUpdateError.message }, 'error')
    }
  } else {
    logger.logPaymentProcessing('registration-payment-record-not-found', `No payment record found for payment intent: ${paymentIntent.id}`, { paymentIntentId: paymentIntent.id }, 'error')
    throw new Error('Payment record not found - checkout process may have failed')
  }

  // Xero integration is now handled entirely by the payment completion processor
  // This ensures consistent handling of staging records, emails, and batch sync

  // Trigger payment completion processor for emails and post-processing
  try {
    await paymentProcessor.processPaymentCompletion({
      event_type: 'user_registrations',
      record_id: userRegistration.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_registration',
      timestamp: new Date().toISOString(),
      metadata: {
        payment_intent_id: paymentIntent.id,
        charge_id: chargeId || undefined,
        xero_staging_record_id: paymentIntent.metadata?.xeroStagingRecordId || undefined
      }
    })
  } catch (processorError) {
    logger.logPaymentProcessing('payment-completion-processor-failed', 'Failed to trigger payment completion processor for registration', {
      paymentIntentId: paymentIntent.id,
      error: processorError instanceof Error ? processorError.message : String(processorError),
      stack: processorError instanceof Error ? processorError.stack : undefined
    }, 'error')
    // Don't fail the webhook - registration was processed successfully
  }
}

// Handle charge updated events (when balance transaction becomes available)
async function handleChargeUpdated(supabase: SupabaseClient, charge: Stripe.Charge) {
  try {
    // Get the payment record by payment intent ID
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
    if (!paymentIntentId) {
      logger.logPaymentProcessing('charge-updated-no-payment-intent', 'No payment intent ID found in charge', { chargeId: charge.id }, 'warn')
      return
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single()

    if (paymentError || !payment) {
      logger.logPaymentProcessing('charge-updated-payment-not-found', 'No payment record found for charge update', { paymentIntentId }, 'warn')
      return
    }

    // Get the balance transaction to retrieve the fee
    const balanceTransaction = await getStripe().balanceTransactions.retrieve(charge.balance_transaction as string)

    if (!balanceTransaction || !balanceTransaction.fee) {
      logger.logPaymentProcessing('charge-updated-no-fee', 'No fee found in balance transaction', { paymentIntentId, balanceTransaction: charge.balance_transaction }, 'warn')
      return
    }

    const feeAmount = balanceTransaction.fee

    // Update the payment record with the fee
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        stripe_fee_amount: feeAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id)

    if (updateError) {
      logger.logPaymentProcessing('charge-updated-fee-update-failed', 'Error updating payment with fee', { paymentId: payment.id, error: updateError.message }, 'error')
      return
    }

    logger.logPaymentProcessing('charge-updated-fee-recorded', `Updated payment ${payment.id} with fee: $${(feeAmount / 100).toFixed(2)}`, { paymentId: payment.id, feeAmount }, 'info')

  } catch (error) {
    logger.logPaymentProcessing('charge-updated-error', 'Error processing charge updated event', { chargeId: charge.id, error: error instanceof Error ? error.message : String(error) }, 'error')
  }
}

// Handle charge refunded events
async function handleChargeRefunded(supabase: SupabaseClient, charge: Stripe.Charge) {
  try {
    // Get the payment record by payment intent ID
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null

    if (!paymentIntentId) {
      logger.logPaymentProcessing('charge-refunded-no-payment-intent', 'No payment intent ID found in refunded charge', { chargeId: charge.id }, 'warn')
      return
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single()

    if (paymentError || !payment) {
      logger.logPaymentProcessing('charge-refunded-payment-not-found', 'No payment record found for refunded charge', { paymentIntentId }, 'warn')
      return
    }

    // Process each refund in the charge
    if (charge.refunds && charge.refunds.data) {
      for (const stripeRefund of charge.refunds.data) {
        // Check if we already have this refund in our database
        const { data: existingRefund } = await supabase
          .from('refunds')
          .select('*')
          .eq('stripe_refund_id', stripeRefund.id)
          .single()

        if (existingRefund) {
          logger.logPaymentProcessing('refund-already-exists', `Refund ${stripeRefund.id} already exists in database`, { stripeRefundId: stripeRefund.id, refundId: existingRefund.id }, 'debug')

          // Update status if needed
          if (existingRefund.status !== 'completed') {
            await supabase
              .from('refunds')
              .update({
                status: 'completed',
                completed_at: new Date(stripeRefund.created * 1000).toISOString(),
                stripe_payment_intent_id: paymentIntentId,
                stripe_charge_id: charge.id,
                updated_at: new Date().toISOString()
              })
              .eq('id', existingRefund.id)
          }

          // NEW ARCHITECTURE: Check for staging_id in Stripe metadata
          const stagingId = stripeRefund.metadata?.staging_id
          if (stagingId) {
            // Move staging records from 'staged' to 'pending' for batch sync
            await supabase
              .from('xero_invoices')
              .update({
                sync_status: 'pending',
                updated_at: new Date().toISOString()
              })
              .eq('id', stagingId)
              .eq('sync_status', 'staged')

            await supabase
              .from('xero_payments')
              .update({
                sync_status: 'pending',
                updated_at: new Date().toISOString()
              })
              .eq('xero_invoice_id', stagingId)
              .eq('sync_status', 'staged')

            // Note: Discount usage reversal is now tracked automatically via discount_usage_computed view
            // which derives data from credit note line items in xero_invoice_line_items

            // Send refund notification email
            await stageRefundNotificationEmail(existingRefund.id, payment.user_id, payment.id)
          } else {
            // EXTERNAL REFUND: No staging_id means this was processed outside our system
            // Log alert for manual intervention at ERROR level for Sentry reporting
            logger.logSystem('external-refund-detected', 'External refund requires manual Xero credit note creation', {
              refundId: existingRefund.id,
              stripeRefundId: stripeRefund.id,
              paymentId: payment.id,
              amount: stripeRefund.amount,
              source: 'external_stripe_refund',
              action_required: 'Manual Xero credit note creation needed'
            }, 'error')
          }

          continue
        }

        // Create new refund record for refunds not initiated through our system
        // (e.g., refunds processed directly in Stripe dashboard)
        const refundReason = stripeRefund.metadata?.reason || 'Refund processed via Stripe'
        const processedBy = stripeRefund.metadata?.processed_by || null

        const { data: newRefund, error: refundError } = await supabase
          .from('refunds')
          .insert({
            payment_id: payment.id,
            user_id: payment.user_id,
            amount: stripeRefund.amount,
            reason: refundReason,
            stripe_refund_id: stripeRefund.id,
            stripe_payment_intent_id: paymentIntentId,
            stripe_charge_id: charge.id,
            status: 'completed',
            processed_by: processedBy || payment.user_id, // Fallback to payment user if no admin specified
            completed_at: new Date(stripeRefund.created * 1000).toISOString(),
          })
          .select()
          .single()

        if (refundError) {
          logger.logPaymentProcessing('refund-record-create-failed', `Error creating refund record for ${stripeRefund.id}`, { stripeRefundId: stripeRefund.id, error: refundError.message }, 'error')
          continue
        }

        logger.logPaymentProcessing('refund-record-created', `Created refund record ${newRefund.id} for Stripe refund ${stripeRefund.id}`, { refundId: newRefund.id, stripeRefundId: stripeRefund.id }, 'info')

        // Log alert for manual intervention - no automatic Xero credit note creation
        logger.logSystem('external-refund-created', 'External refund detected - manual Xero credit note required', {
          refundId: newRefund.id,
          stripeRefundId: stripeRefund.id,
          paymentId: payment.id,
          amount: stripeRefund.amount,
          reason: refundReason,
          source: 'external_stripe_dashboard',
          action_required: 'Admin must manually create Xero credit note to match this refund'
        }, 'error')
      }
    }

    // Check if payment should be marked as refunded
    const { data: allRefunds } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', payment.id)
      .eq('status', 'completed')

    const totalRefunded = allRefunds?.reduce((sum: number, refund: { amount: number }) => sum + refund.amount, 0) || 0

    // If fully refunded, update payment status
    if (totalRefunded >= payment.final_amount && payment.status !== 'refunded') {
      await supabase
        .from('payments')
        .update({
          status: 'refunded',
          refund_reason: 'Fully refunded',
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.id)

      logger.logPaymentProcessing('payment-marked-refunded', `Updated payment ${payment.id} status to refunded (total refunded: $${(totalRefunded / 100).toFixed(2)})`, { paymentId: payment.id, totalRefunded }, 'info')
    }

  } catch (error) {
    logger.logPaymentProcessing('charge-refunded-error', 'Error processing charge refunded event', { chargeId: charge.id, error: error instanceof Error ? error.message : String(error) }, 'error')
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(body, signature, endpointSecret)

    // Log webhook event immediately after signature verification
    logger.logSystem('webhook-event-received', 'Webhook event received', {
      eventType: event.type,
      eventId: event.id,
      created: event.created,
      dataObjectId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown'
    }, 'debug')
  } catch (err) {
    logger.logSystem('webhook-signature-verification-failed', 'Webhook signature verification failed', { error: err instanceof Error ? err.message : String(err) }, 'error')
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createAdminClient()
  } catch (dbError) {
    logger.logSystem('webhook-database-connection-failed', 'Failed to create database connection', { error: dbError instanceof Error ? dbError.message : String(dbError) }, 'error')
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
  }

  try {

    switch (event.type) {

      case 'charge.updated': {
        const charge = event.data.object as Stripe.Charge

        // Only process if balance transaction is now available
        if (charge.balance_transaction && typeof charge.balance_transaction === 'string') {
          await handleChargeUpdated(supabase, charge)
        } else {
          // Routine - charge.updated fires multiple times as the balance transaction settles
          logger.logPaymentProcessing('charge-updated-balance-transaction-pending', 'Charge updated but no balance transaction available yet', {
            chargeId: charge.id,
            balanceTransaction: charge.balance_transaction
          }, 'debug')
        }
        break
      }

      case 'charge.refunded': {
        // Retrieve the charge with expanded refunds data
        const chargeId = (event.data.object as Stripe.Charge).id
        const charge = await getStripe().charges.retrieve(chargeId, {
          expand: ['refunds']
        })

        await handleChargeRefunded(supabase, charge)
        break
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent

        const userId = setupIntent.metadata?.supabase_user_id || setupIntent.metadata?.userId
        if (!userId) {
          logger.logPaymentProcessing('setup-intent-missing-user-id', 'Setup Intent missing userId in metadata', { setupIntentId: setupIntent.id }, 'error')
          break
        }

        if (!setupIntent.payment_method) {
          logger.logPaymentProcessing('setup-intent-missing-payment-method', 'Setup Intent missing payment method', { setupIntentId: setupIntent.id }, 'error')
          break
        }

        try {
          // Update user record with payment method
          const { error: updateError } = await supabase
            .from('users')
            .update({
              stripe_payment_method_id: setupIntent.payment_method as string,
              stripe_setup_intent_id: setupIntent.id,
              setup_intent_status: 'succeeded',
              payment_method_updated_at: new Date().toISOString()
            })
            .eq('id', userId)

          if (updateError) {
            throw updateError
          }

          logger.logPaymentProcessing('setup-intent-payment-method-updated', 'Successfully updated user with payment method', {
            userId,
            setupIntentId: setupIntent.id,
            paymentMethodId: setupIntent.payment_method
          }, 'info')
        } catch (error) {
          logger.logPaymentProcessing('setup-intent-succeeded-error', 'Error processing setup_intent.succeeded', { userId, setupIntentId: setupIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
          throw error
        }
        break
      }

      case 'setup_intent.setup_failed': {
        const setupIntent = event.data.object as Stripe.SetupIntent

        const userId = setupIntent.metadata?.userId
        if (!userId) {
          logger.logPaymentProcessing('setup-intent-missing-user-id', 'Setup Intent missing userId in metadata', { setupIntentId: setupIntent.id }, 'error')
          break
        }

        try {
          // Update user record to reflect failed status
          const { error: updateError } = await supabase
            .from('users')
            .update({
              setup_intent_status: 'failed',
              payment_method_updated_at: new Date().toISOString()
            })
            .eq('id', userId)

          if (updateError) {
            throw updateError
          }

          logger.logPaymentProcessing('setup-intent-failed-status-updated', 'Successfully updated user with failed setup status', {
            userId,
            setupIntentId: setupIntent.id
          }, 'info')
        } catch (error) {
          logger.logPaymentProcessing('setup-intent-setup-failed-error', 'Error processing setup_intent.setup_failed', { userId, setupIntentId: setupIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
          throw error
        }
        break
      }

      case 'payment_method.detached': {
        const paymentMethod = event.data.object as Stripe.PaymentMethod

        try {
          // Find user with this payment method and clean up
          const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email')
            .eq('stripe_payment_method_id', paymentMethod.id)
            .single()

          if (userError || !user) {
            break
          }

          // Get payment method details for email
          const lastFourDigits = paymentMethod.card?.last4 || '****'

          // Update user record
          const { error: updateError } = await supabase
            .from('users')
            .update({
              stripe_payment_method_id: null,
              stripe_setup_intent_id: null,
              setup_intent_status: null,
              payment_method_updated_at: new Date().toISOString()
            })
            .eq('id', user.id)

          if (updateError) {
            throw updateError
          }

          // Remove user from all alternate registrations
          const { error: alternateRemovalError } = await supabase
            .from('user_alternate_registrations')
            .delete()
            .eq('user_id', user.id)

          if (alternateRemovalError) {
            logger.logPaymentProcessing('payment-method-detached-alternate-removal-failed', 'Failed to remove user from alternate registrations', { userId: user.id, error: alternateRemovalError.message }, 'warn')
            // Don't throw - this is not critical
          }

          // Stage email notification for payment method removal
          const { emailStagingManager } = await import('@/lib/email/staging')
          
          if (process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID) {
            await emailStagingManager.stageEmail({
              user_id: user.id,
              email_address: user.email,
              event_type: 'payment_method.removed',
              subject: 'Payment Method Removed',
              template_id: process.env.LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID,
              email_data: {
                userName: `${user.first_name} ${user.last_name}`,
                paymentMethod: `****${lastFourDigits}`,
                dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user`
              }
            })
          }

          logger.logPaymentProcessing('payment-method-detached-cleaned-up', 'Successfully cleaned up user data after payment method detachment', {
            userId: user.id,
            paymentMethodId: paymentMethod.id
          }, 'info')
        } catch (error) {
          logger.logPaymentProcessing('payment-method-detached-error', 'Error processing payment_method.detached', { paymentMethodId: paymentMethod.id, error: error instanceof Error ? error.message : String(error) }, 'error')
          throw error
        }
        break
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        // Check if this is a waitlist selection payment
        if (paymentIntent.metadata?.purpose === 'waitlist_selection') {
          try {
            // Get actual Stripe fees and charge ID from the charge
            const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)

            // Update payment record status
            const { data: updatedPayment, error: paymentUpdateError } = await supabase
              .from('payments')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                stripe_fee_amount: stripeFeeAmount,
                stripe_charge_id: chargeId
              })
              .eq('stripe_payment_intent_id', paymentIntent.id)
              .select()
              .single()

            if (paymentUpdateError || !updatedPayment) {
              logger.logPaymentProcessing('waitlist-payment-record-update-failed', 'Failed to update waitlist payment record', { paymentIntentId: paymentIntent.id, error: paymentUpdateError?.message }, 'error')
              throw paymentUpdateError || new Error('No payment record found')
            }
            logger.logPaymentProcessing('waitlist-payment-record-updated', `Successfully updated waitlist payment record (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`, { paymentIntentId: paymentIntent.id, stripeFeeAmount }, 'info')

            // Note: user_registrations record is already created as 'paid' by the waitlist selection API
            // No need to update it here - just verify it exists
            const { data: existingRegistration } = await supabase
              .from('user_registrations')
              .select('id')
              .eq('user_id', paymentIntent.metadata.userId)
              .eq('registration_id', paymentIntent.metadata.registrationId)
              .eq('payment_id', updatedPayment.id)
              .single()

            if (!existingRegistration) {
              logger.logPaymentProcessing('waitlist-registration-not-found', 'Waitlist registration record not found - may have been created after webhook', { paymentIntentId: paymentIntent.id }, 'warn')
            }

            // Process through payment completion processor for Xero updates and emails
            try {
              const completionEvent = {
                event_type: 'user_registrations' as const,
                record_id: existingRegistration?.id || null,
                user_id: paymentIntent.metadata.userId,
                payment_id: updatedPayment.id,
                amount: paymentIntent.amount,
                trigger_source: 'stripe_webhook_waitlist',
                timestamp: new Date().toISOString(),
                metadata: {
                  payment_intent_id: paymentIntent.id,
                  charge_id: chargeId || undefined,
                  xero_staging_record_id: paymentIntent.metadata?.xeroStagingRecordId || undefined
                }
              }

              await paymentProcessor.processPaymentCompletion(completionEvent)
            } catch (processorError) {
              logger.logPaymentProcessing('payment-completion-processor-failed', 'Payment completion processor failed for waitlist selection', { paymentIntentId: paymentIntent.id, error: processorError instanceof Error ? processorError.message : String(processorError) }, 'error')
              // Don't throw - payment succeeded, this is just post-processing
            }
          } catch (error) {
            logger.logPaymentProcessing('waitlist-payment-intent-succeeded-error', 'Error processing waitlist payment_intent.succeeded', { paymentIntentId: paymentIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
            throw error
          }

          return NextResponse.json({ received: true })
        }

        // Check if this is an alternate payment
        if (paymentIntent.metadata?.purpose === 'alternate_selection') {
          try {
            // Get actual Stripe fees and charge ID from the charge
            const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)

            // Update payment record status and get the payment record
            const { data: updatedPayment, error: paymentUpdateError } = await supabase
              .from('payments')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                stripe_fee_amount: stripeFeeAmount,
                stripe_charge_id: chargeId
              })
              .eq('stripe_payment_intent_id', paymentIntent.id)
              .select()
              .single()

            if (paymentUpdateError || !updatedPayment) {
              logger.logPaymentProcessing('alternate-payment-record-update-failed', 'Failed to update alternate payment record', { paymentIntentId: paymentIntent.id, error: paymentUpdateError?.message }, 'error')
              throw paymentUpdateError || new Error('No payment record found')
            }
            logger.logPaymentProcessing('alternate-payment-record-updated', `Successfully updated alternate payment record (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`, { paymentIntentId: paymentIntent.id, stripeFeeAmount }, 'info')

            // Ensure alternate_selections record exists (fallback for failed initial creation)
            const gameId = paymentIntent.metadata.gameId
            if (gameId) {
              const { error: selectionError } = await supabase
                .from('alternate_selections')
                .upsert({
                  alternate_registration_id: gameId,
                  user_id: paymentIntent.metadata.userId,
                  payment_id: updatedPayment.id,
                  amount_charged: paymentIntent.amount,
                  selected_by: paymentIntent.metadata.selectedBy || paymentIntent.metadata.userId,
                  selected_at: new Date().toISOString()
                }, {
                  onConflict: 'alternate_registration_id,user_id',
                  ignoreDuplicates: false
                })

              if (selectionError) {
                logger.logPaymentProcessing('alternate-selection-record-failed', 'Failed to create/update alternate selection record in webhook', { paymentIntentId: paymentIntent.id, gameId, error: selectionError.message }, 'warn')
              }
            } else {
              logger.logPaymentProcessing('alternate-selection-missing-game-id', 'No gameId in payment metadata - cannot create alternate selection record', { paymentIntentId: paymentIntent.id }, 'warn')
            }

            // Process through payment completion processor for Xero updates and emails
            try {
              const completionEvent = {
                event_type: 'alternate_selections' as const,
                record_id: null, // Not needed for alternate selections
                user_id: paymentIntent.metadata.userId,
                payment_id: updatedPayment.id,
                amount: paymentIntent.amount,
                trigger_source: 'stripe_webhook_alternate',
                timestamp: new Date().toISOString(),
                metadata: {
                  payment_intent_id: paymentIntent.id,
                  charge_id: chargeId || undefined,
                  xero_staging_record_id: paymentIntent.metadata?.xeroStagingRecordId || undefined
                }
              }

              await paymentProcessor.processPaymentCompletion(completionEvent)
            } catch (processorError) {
              logger.logPaymentProcessing('payment-completion-processor-failed', 'Payment completion processor failed for alternate selection', { paymentIntentId: paymentIntent.id, error: processorError instanceof Error ? processorError.message : String(processorError) }, 'error')
              // Don't throw - payment succeeded, this is just post-processing
            }
          } catch (error) {
            logger.logPaymentProcessing('alternate-payment-intent-succeeded-error', 'Error processing alternate payment_intent.succeeded', { paymentIntentId: paymentIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
            throw error
          }
          break
        }

        // Check if this is a payment plan installment payment
        if (paymentIntent.metadata?.purpose === 'payment_plan_installment') {
          // Update payment record status - already handled by PaymentPlanService
          // This webhook primarily serves as confirmation
          break
        }

        // Check if this is a payment plan early payoff
        if (paymentIntent.metadata?.purpose === 'payment_plan_early_payoff') {
          try {
            // Get actual Stripe fees and charge ID from the charge
            const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)

            // Update payment record to completed
            const { data: updatedPayment, error: paymentUpdateError } = await supabase
              .from('payments')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                stripe_fee_amount: stripeFeeAmount,
                stripe_charge_id: chargeId
              })
              .eq('id', paymentIntent.metadata.paymentId)
              .select()
              .single()

            if (paymentUpdateError || !updatedPayment) {
              logger.logPaymentProcessing('early-payoff-payment-record-update-failed', 'Failed to update early payoff payment record', { paymentIntentId: paymentIntent.id, error: paymentUpdateError?.message }, 'error')
              throw paymentUpdateError || new Error('No payment record found')
            }
            logger.logPaymentProcessing('early-payoff-payment-record-updated', `Successfully updated early payoff payment record (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`, { paymentIntentId: paymentIntent.id, stripeFeeAmount }, 'info')

            // Find the staged xero_payment for this invoice
            const { data: stagedPayment, error: stagedPaymentError } = await supabase
              .from('xero_payments')
              .select('*')
              .eq('xero_invoice_id', paymentIntent.metadata.xeroStagingRecordId)
              .eq('sync_status', 'staged')
              .eq('payment_type', 'full')
              .single()

            if (stagedPaymentError || !stagedPayment) {
              logger.logXeroSync('early-payoff-staged-payment-not-found', 'Failed to find staged early payoff xero_payment', { paymentIntentId: paymentIntent.id, error: stagedPaymentError?.message }, 'error')
              throw stagedPaymentError || new Error('No staged payment found')
            }

            // Update staged xero_payment to pending (ready for sync)
            await supabase
              .from('xero_payments')
              .update({
                sync_status: 'pending',
                staging_metadata: {
                  ...(stagedPayment.staging_metadata || {}),
                  payment_id: updatedPayment.id,
                  stripe_payment_intent_id: paymentIntent.id,
                  stripe_charge_id: chargeId,
                  processed_at: new Date().toISOString()
                }
              })
              .eq('id', stagedPayment.id)

            logger.logPaymentProcessing('early-payoff-processed', 'Early payoff payment processed successfully via webhook', { paymentIntentId: paymentIntent.id }, 'info')
          } catch (error) {
            logger.logPaymentProcessing('early-payoff-webhook-error', 'Error processing early payoff webhook', { paymentIntentId: paymentIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
            throw error // Throw to retry webhook
          }
          break
        }

        // Check if this is a payment plan first payment
        if (paymentIntent.metadata?.isPaymentPlan === 'true') {
          try {
            const { PaymentPlanService } = await import('@/lib/services/payment-plan-service')
            const { savePaymentMethodFromIntent } = await import('@/lib/services/payment-method-service')

            // Get actual Stripe fees and charge ID from the charge
            const { fee: stripeFeeAmount, chargeId } = await getStripeFeeAmountAndChargeId(paymentIntent)

            // Update payment record status
            const { data: updatedPayment, error: paymentUpdateError } = await supabase
              .from('payments')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                stripe_fee_amount: stripeFeeAmount,
                stripe_charge_id: chargeId
              })
              .eq('stripe_payment_intent_id', paymentIntent.id)
              .select()
              .single()

            if (paymentUpdateError || !updatedPayment) {
              logger.logPaymentProcessing('payment-plan-payment-record-update-failed', 'Failed to update payment plan payment record', { paymentIntentId: paymentIntent.id, error: paymentUpdateError?.message }, 'error')
              throw paymentUpdateError || new Error('No payment record found')
            }
            logger.logPaymentProcessing('payment-plan-payment-record-updated', `Successfully updated payment plan payment record (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`, { paymentIntentId: paymentIntent.id, stripeFeeAmount }, 'info')

            // Save payment method to user profile (required for future charges)
            await savePaymentMethodFromIntent(paymentIntent, paymentIntent.metadata.userId, supabase)

            // Handle idempotent webhook delivery - check if registration already paid
            let userRegistration: UserRegistrationRow

            // First, check if registration already exists and is paid (idempotency)
            const { data: existingPaidRegistration } = await supabase
              .from('user_registrations')
              .select('*')
              .eq('user_id', paymentIntent.metadata.userId)
              .eq('registration_id', paymentIntent.metadata.registrationId)
              .eq('payment_status', 'paid')
              .single()

            if (existingPaidRegistration) {
              logger.logPaymentProcessing('payment-plan-registration-already-paid', 'Payment plan registration already paid (idempotent webhook), using existing record', { paymentIntentId: paymentIntent.id, registrationId: existingPaidRegistration.id }, 'debug')
              userRegistration = existingPaidRegistration
            } else {
              // Update user_registration to paid status and set registered_at timestamp
              const { data: updatedRegistration, error: regError } = await supabase
                .from('user_registrations')
                .update({
                  payment_status: 'paid',
                  registered_at: new Date().toISOString(),
                  stripe_payment_intent_id: paymentIntent.id,
                })
                .eq('user_id', paymentIntent.metadata.userId)
                .eq('registration_id', paymentIntent.metadata.registrationId)
                .in('payment_status', ['awaiting_payment', 'processing'])
                .select()
                .single()

              if (regError || !updatedRegistration) {
                // Try to find any registration record for debugging
                const { data: allRegistrations } = await supabase
                  .from('user_registrations')
                  .select('*')
                  .eq('user_id', paymentIntent.metadata.userId)
                  .eq('registration_id', paymentIntent.metadata.registrationId)

                logger.logPaymentProcessing('payment-plan-registration-not-found', 'Failed to find user registration record', {
                  paymentIntentId: paymentIntent.id,
                  userId: paymentIntent.metadata.userId,
                  registrationId: paymentIntent.metadata.registrationId,
                  error: regError?.message,
                  allRegistrationsFound: allRegistrations
                }, 'error')
                throw regError || new Error('User registration not found')
              }

              userRegistration = updatedRegistration
            }

            // Get xero_invoice_id from payment intent metadata
            // This value is used for both registration linking and payment plan creation
            const xeroInvoiceId = paymentIntent.metadata.xeroStagingRecordId

            // Link user_registration to payment record and xero_invoice (if not already linked)
            if (!userRegistration.payment_id) {
              // Normal case: payment_id not yet set, link it now
              const { error: registrationUpdateError } = await supabase
                .from('user_registrations')
                .update({
                  payment_id: updatedPayment.id,
                  xero_invoice_id: xeroInvoiceId // Link to xero_invoice for payment plan queries
                })
                .eq('id', userRegistration.id)

              if (registrationUpdateError) {
                logger.logPaymentProcessing('payment-plan-registration-link-failed', 'Failed to link registration to payment', { paymentIntentId: paymentIntent.id, registrationId: userRegistration.id, error: registrationUpdateError.message }, 'warn')
                // Don't throw - registration is paid, this is just linking
              }
            } else if (userRegistration.payment_id !== updatedPayment.id) {
              // Unexpected case: registration already linked to a different payment
              // This indicates a potential data integrity issue - guaranteed Sentry alert
              logger.reportWarningToSentry('payment-processing', 'registration-payment-mismatch', 'Registration already linked to different payment - skipping update to preserve existing link, manual review needed', {
                registrationId: userRegistration.id,
                existingPaymentId: userRegistration.payment_id,
                currentPaymentId: updatedPayment.id,
                paymentIntentId: paymentIntent.id
              })
            } else {
              // Already linked to correct payment (idempotent webhook delivery)
              // But make sure xero_invoice_id is also set
              if (!userRegistration.xero_invoice_id) {
                const { error: invoiceLinkError } = await supabase
                  .from('user_registrations')
                  .update({ xero_invoice_id: xeroInvoiceId })
                  .eq('id', userRegistration.id)

                if (invoiceLinkError) {
                  logger.logPaymentProcessing('payment-plan-xero-invoice-link-failed', 'Failed to link registration to xero_invoice', { paymentIntentId: paymentIntent.id, xeroInvoiceId, error: invoiceLinkError.message }, 'warn')
                }
              }
            }

            // Create payment plan (with idempotency - may already exist if webhook retried)
            const totalAmount = parseInt(paymentIntent.metadata.paymentPlanTotalAmount || '0')

            // Get xero_invoice to check if plan exists and get tenant_id
            const { data: xeroInvoice, error: invoiceError } = await supabase
              .from('xero_invoices')
              .select('id, tenant_id, is_payment_plan')
              .eq('id', xeroInvoiceId)
              .single()

            if (invoiceError || !xeroInvoice) {
              logger.logXeroSync('payment-plan-xero-invoice-not-found', 'Failed to find xero_invoice', { paymentIntentId: paymentIntent.id, xeroInvoiceId, error: invoiceError?.message }, 'error')
              throw new Error('Xero invoice not found')
            }

            let paymentPlanId: string = xeroInvoice.id

            // Check if payment plan already exists (idempotent webhook delivery)
            if (xeroInvoice.is_payment_plan) {
              logger.logPaymentProcessing('payment-plan-already-exists', 'Payment plan already exists (idempotent webhook), using existing plan', { paymentIntentId: paymentIntent.id, paymentPlanId }, 'debug')

              // Update payment #1's metadata with payment details
              const { data: firstPayment } = await supabase
                .from('xero_payments')
                .select('id, staging_metadata')
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('payment_type', 'installment')
                .eq('installment_number', 1)
                .single()

              if (firstPayment) {
                const updatedMetadata = {
                  ...firstPayment.staging_metadata,
                  payment_id: updatedPayment.id,
                  stripe_payment_intent_id: paymentIntent.id,
                  stripe_charge_id: chargeId,
                  updated_at: new Date().toISOString()
                }

                const { error: metadataUpdateError } = await supabase
                  .from('xero_payments')
                  .update({
                    staging_metadata: updatedMetadata,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', firstPayment.id)

                if (metadataUpdateError) {
                  logger.logPaymentProcessing('payment-plan-metadata-update-failed', 'Failed to update payment #1 metadata', { paymentIntentId: paymentIntent.id, error: metadataUpdateError.message }, 'warn')
                  // Don't throw - payment is successful, this is just metadata
                }
              }

              // Update payment #1 to 'pending' and #2-4 to 'planned' (in case webhook is retried)
              await updatePaymentPlanStatuses(supabase, xeroInvoiceId)
            } else {
              // Create new payment plan (4 xero_payments records)
              const result = await PaymentPlanService.createPaymentPlan({
                userRegistrationId: userRegistration.id,
                userId: paymentIntent.metadata.userId,
                totalAmount: totalAmount,
                xeroInvoiceId: xeroInvoiceId,
                firstPaymentId: updatedPayment.id,
                tenantId: xeroInvoice.tenant_id
              })

              if (!result.success) {
                logger.logPaymentProcessing('payment-plan-create-failed', 'Failed to create payment plan', { paymentIntentId: paymentIntent.id, error: result.error }, 'error')
                throw new Error(`Failed to create payment plan: ${result.error}`)
              }

              paymentPlanId = result.paymentPlanId!
              logger.logPaymentProcessing('payment-plan-created', 'Successfully created payment plan xero_payments', { paymentIntentId: paymentIntent.id, paymentPlanId }, 'info')

              // Now update the xero_payments statuses:
              // Payment #1 → 'pending' (ready to sync to Xero)
              // Payments #2-4 → 'planned' (wait for scheduled date)
              await updatePaymentPlanStatuses(supabase, xeroInvoiceId)
            }

            // Process through payment completion processor for Xero updates and emails
            try {
              const completionEvent = {
                event_type: 'user_registrations' as const,
                record_id: userRegistration.id,
                user_id: paymentIntent.metadata.userId,
                payment_id: updatedPayment.id,
                amount: paymentIntent.amount,
                trigger_source: 'stripe_webhook_registration', // Use standard registration trigger for emails
                timestamp: new Date().toISOString(),
                metadata: {
                  payment_intent_id: paymentIntent.id,
                  charge_id: chargeId ?? undefined,
                  xero_staging_record_id: paymentIntent.metadata?.xeroStagingRecordId || undefined,
                  is_payment_plan: true,
                  payment_plan_id: paymentPlanId
                }
              }

              await paymentProcessor.processPaymentCompletion(completionEvent)
            } catch (processorError) {
              logger.logPaymentProcessing('payment-completion-processor-failed', 'Payment completion processor failed for payment plan', { paymentIntentId: paymentIntent.id, error: processorError instanceof Error ? processorError.message : String(processorError) }, 'error')
              // Don't throw - payment succeeded, this is just post-processing
            }
          } catch (error) {
            logger.logPaymentProcessing('payment-plan-payment-intent-succeeded-error', 'Error processing payment plan payment_intent.succeeded', { paymentIntentId: paymentIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
            throw error
          }
          break
        }

        // Fall through to existing payment_intent.succeeded handling for regular payments
        const userId = paymentIntent.metadata.userId
        const membershipId = paymentIntent.metadata.membershipId
        const registrationId = paymentIntent.metadata.registrationId
        const durationMonths = paymentIntent.metadata.durationMonths ? parseInt(paymentIntent.metadata.durationMonths) : null

        // Handle membership payment
        if (membershipId && userId && durationMonths) {
          await handleMembershipPayment(supabase, supabase, paymentIntent, userId, membershipId, durationMonths)
        }
        // Handle registration payment
        else if (registrationId && userId) {
          await handleRegistrationPayment(supabase, paymentIntent, userId, registrationId)
        }
        else {
          logger.logPaymentProcessing('payment-intent-missing-metadata', 'Payment intent missing required metadata', {
            paymentIntentId: paymentIntent.id,
            hasUserId: !!userId,
            hasMembershipId: !!membershipId,
            hasRegistrationId: !!registrationId,
            hasDurationMonths: !!durationMonths,
            allMetadata: paymentIntent.metadata
          }, 'error')
        }
        break
      }

      case 'payment_intent.payment_failed': {
        // Check if this is an alternate payment
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        if (paymentIntent.metadata?.purpose === 'alternate_selection') {
          try {
            // Update payment record status
            const { error: paymentUpdateError } = await supabase
              .from('payments')
              .update({
                status: 'failed',
                updated_at: new Date().toISOString()
              })
              .eq('stripe_payment_intent_id', paymentIntent.id)

            if (paymentUpdateError) {
              throw paymentUpdateError
            }

            // TODO: Send notification to captain and alternate about failed payment
            // This could be handled by the payment completion processor
          } catch (error) {
            logger.logPaymentProcessing('alternate-payment-failed-error', 'Error processing failed alternate payment', { paymentIntentId: paymentIntent.id, error: error instanceof Error ? error.message : String(error) }, 'error')
            throw error
          }
          break
        }

        // Fall through to existing payment_intent.payment_failed handling for regular payments
        const userId = paymentIntent.metadata.userId
        const membershipId = paymentIntent.metadata.membershipId
        const registrationId = paymentIntent.metadata.registrationId

        // Update payment record
        await supabase
          .from('payments')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)

        // Release registration reservation if this was a registration payment
        if (registrationId && userId) {
          await supabase
            .from('user_registrations')
            .update({
              payment_status: 'failed',
              reservation_expires_at: null // Release the reservation immediately
            })
            .eq('user_id', userId)
            .eq('registration_id', registrationId)
            .eq('payment_status', 'awaiting_payment') // Only update if still awaiting payment
        }

        // Clean up draft invoice if it exists
        try {
          const invoiceNumber = paymentIntent.metadata.invoiceNumber
          const xeroInvoiceId = paymentIntent.metadata.xeroInvoiceId

          if (invoiceNumber && xeroInvoiceId) {
            // Delete the draft invoice from Xero
            const deleteResult = await deleteXeroDraftInvoice(xeroInvoiceId)

            if (deleteResult.success) {
              // Delete the draft invoice from our database
              await supabase
                .from('xero_invoices')
                .delete()
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('sync_status', 'pending') // Only delete if still pending

              logger.logXeroSync('draft-invoice-cleaned-up', `Fully cleaned up draft invoice ${invoiceNumber} after payment failure`, { paymentIntentId: paymentIntent.id, invoiceNumber, xeroInvoiceId }, 'info')
            } else {
              logger.logXeroSync('draft-invoice-xero-delete-failed', `Failed to delete invoice from Xero: ${deleteResult.error}`, { paymentIntentId: paymentIntent.id, invoiceNumber, xeroInvoiceId, error: deleteResult.error }, 'warn')
              // Still clean up our database tracking even if Xero deletion fails
              await supabase
                .from('xero_invoices')
                .delete()
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('sync_status', 'pending')
            }
          }
        } catch (cleanupError) {
          logger.logXeroSync('draft-invoice-cleanup-error', 'Error cleaning up draft invoice after payment failure', { paymentIntentId: paymentIntent.id, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }, 'warn')
          // Don't fail the webhook over cleanup issues
        }

        // Trigger payment completion processor for failed payment emails
        try {
          if (userId) {
            const eventType = membershipId ? 'user_memberships' : (registrationId ? 'user_registrations' : null)

            if (eventType) {
              await paymentProcessor.processPaymentCompletion({
                event_type: eventType,
                record_id: null, // No record created for failed payment
                user_id: userId,
                payment_id: null, // No successful payment record
                amount: paymentIntent.amount,
                trigger_source: 'stripe_webhook_payment_failed',
                timestamp: new Date().toISOString(),
                metadata: {
                  payment_intent_id: paymentIntent.id,
                  failure_reason: paymentIntent.last_payment_error?.message || 'Unknown error',
                  failed: true
                }
              })
            }
          }
        } catch (processorError) {
          logger.logPaymentProcessing('payment-completion-processor-failed', 'Failed to trigger payment completion processor for failed payment', { paymentIntentId: paymentIntent.id, error: processorError instanceof Error ? processorError.message : String(processorError) }, 'error')
          // Don't fail the webhook - payment failure was already recorded
        }

        if (!userId) {
          logger.logPaymentProcessing('failed-payment-intent-missing-metadata', 'Failed payment intent missing required metadata', {
            paymentIntentId: paymentIntent.id,
            hasUserId: !!userId,
            hasMembershipId: !!membershipId,
            hasRegistrationId: !!registrationId,
            allMetadata: paymentIntent.metadata
          }, 'error')
        }
        break
      }

      default:
        logger.logPaymentProcessing('unhandled-webhook-event', 'Unhandled Stripe webhook event type', { eventType: event.type }, 'debug')
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    // Report critical webhook error via Logger (automatically sends to Sentry)
    logger.logPaymentProcessing(
      'webhook-processing-error',
      'Critical webhook processing error',
      {
        eventType: event.type,
        paymentIntentId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown',
        webhookBody: body.substring(0, 1000), // First 1000 chars for context
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      'error'
    )

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}