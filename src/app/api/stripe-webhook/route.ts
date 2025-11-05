import { NextRequest, NextResponse } from 'next/server'
import { formatDate } from '@/lib/date-utils'

import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { calculateMembershipStartDate, calculateMembershipEndDate } from '@/lib/membership-utils'
import { deleteXeroDraftInvoice } from '@/lib/xero/invoices'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'
import { emailService } from '@/lib/email/service'

// Force import server config


// Helper function to get actual Stripe fees and charge ID from charge
async function getStripeFeeAmountAndChargeId(paymentIntent: Stripe.PaymentIntent): Promise<{ fee: number; chargeId: string | null }> {
  try {
    // Retrieve the payment intent with expanded charge and balance transaction to get actual fees
    const expandedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id, {
      expand: ['latest_charge', 'latest_charge.balance_transaction']
    })

    console.log(`🔍 Retrieved payment intent with charge data:`, {
      hasLatestCharge: !!expandedPaymentIntent.latest_charge,
      chargeType: typeof expandedPaymentIntent.latest_charge,
      chargeKeys: expandedPaymentIntent.latest_charge && typeof expandedPaymentIntent.latest_charge === 'object'
        ? Object.keys(expandedPaymentIntent.latest_charge)
        : 'N/A'
    })

    if (expandedPaymentIntent.latest_charge &&
      typeof expandedPaymentIntent.latest_charge === 'object' &&
      'id' in expandedPaymentIntent.latest_charge) {

      const chargeId = expandedPaymentIntent.latest_charge.id
      console.log(`🔍 Found charge ID: ${chargeId}, checking for balance transaction...`)

      // Check if balance transaction is available in the expanded charge
      if ('balance_transaction' in expandedPaymentIntent.latest_charge &&
        expandedPaymentIntent.latest_charge.balance_transaction &&
        typeof expandedPaymentIntent.latest_charge.balance_transaction === 'object' &&
        'fee' in expandedPaymentIntent.latest_charge.balance_transaction) {

        const stripeFeeAmount = expandedPaymentIntent.latest_charge.balance_transaction.fee
        console.log(`✅ Retrieved actual Stripe fee from balance transaction: $${(stripeFeeAmount / 100).toFixed(2)} for payment ${paymentIntent.id}`)
        return { fee: stripeFeeAmount, chargeId: chargeId as string }
      }

      // Fallback: retrieve the charge directly to get the fee
      console.log(`🔍 Balance transaction not available, retrieving charge directly...`)
      const charge = await stripe.charges.retrieve(chargeId as string, {
        expand: ['balance_transaction']
      })

      console.log(`🔍 Retrieved charge data:`, {
        chargeId: charge.id,
        hasBalanceTransaction: !!charge.balance_transaction,
        balanceTransactionKeys: charge.balance_transaction && typeof charge.balance_transaction === 'object'
          ? Object.keys(charge.balance_transaction)
          : 'N/A',
        hasFee: charge.balance_transaction && typeof charge.balance_transaction === 'object' && 'fee' in charge.balance_transaction,
        feeType: charge.balance_transaction && typeof charge.balance_transaction === 'object' ? typeof charge.balance_transaction.fee : 'undefined',
        feeValue: charge.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction.fee : undefined
      })

      if (charge.balance_transaction &&
        typeof charge.balance_transaction === 'object' &&
        'fee' in charge.balance_transaction &&
        typeof charge.balance_transaction.fee === 'number') {
        const stripeFeeAmount = charge.balance_transaction.fee
        console.log(`✅ Retrieved actual Stripe fee from charge balance transaction: $${(stripeFeeAmount / 100).toFixed(2)} for payment ${paymentIntent.id}`)
        return { fee: stripeFeeAmount, chargeId: chargeId as string }
      } else {
        console.log(`⚠️ Fee not available in balance transaction, setting fee to 0 for payment ${paymentIntent.id}`)
        return { fee: 0, chargeId: chargeId as string }
      }
    } else {
      console.log(`⚠️ Charge not available, setting fee to 0 for payment ${paymentIntent.id}`)
      return { fee: 0, chargeId: null }
    }
  } catch (feeError) {
    // Fallback to 0 if there's an error retrieving the balance transaction
    console.error(`❌ Error retrieving Stripe fees, setting fee to 0 for payment ${paymentIntent.id}`, feeError)
    return { fee: 0, chargeId: null }
  }
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

// Handle membership payment processing
async function handleMembershipPayment(supabase: any, adminSupabase: any, paymentIntent: Stripe.PaymentIntent, userId: string, membershipId: string, durationMonths: number) {
  // Check if user membership already exists (avoid duplicates)
  const { data: existingMembership } = await supabase
    .from('user_memberships')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

  let membershipRecord: any

  if (existingMembership) {
    console.log('User membership already exists for payment intent:', paymentIntent.id)

    // Update payment status from 'pending' to 'paid' if needed
    if (existingMembership.payment_status === 'pending') {
      console.log('Updating existing membership payment status from pending to paid')
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
        console.error('Error updating membership payment status:', updateError)
        throw new Error('Failed to update membership payment status')
      }

      membershipRecord = updatedMembership
      console.log('Successfully updated membership payment status to paid')
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
          console.log('Membership already exists for payment intent, fetching existing record:', paymentIntent.id)
          const { data: existingMembership, error: fetchError } = await supabase
            .from('user_memberships')
            .select('*')
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .single()

          if (fetchError || !existingMembership) {
            console.error('Error fetching existing membership:', fetchError)
            throw new Error('Failed to fetch existing membership')
          }

          membershipRecord = existingMembership
        } else {
          console.error('Error creating user membership:', membershipError)
          throw new Error('Failed to create membership')
        }
      } else {
        membershipRecord = newMembership
      }
    } catch (error) {
      console.error('Error in membership creation/fetch:', error)
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
    console.error('❌ Webhook: Error updating membership payment record:', paymentUpdateError)
    throw new Error('Failed to update payment record')
  } else if (updatedPayment && updatedPayment.length > 0) {
    console.log(`✅ Webhook: Updated membership payment record to completed: ${updatedPayment[0].id} (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`)

    // Update user_memberships record with payment_id
    const { error: membershipUpdateError } = await adminSupabase
      .from('user_memberships')
      .update({ payment_id: updatedPayment[0].id })
      .eq('id', membershipRecord.id)

    if (membershipUpdateError) {
      console.error('❌ Webhook: Error updating membership record with payment_id:', membershipUpdateError)
    } else {
      console.log(`✅ Webhook: Updated membership record with payment_id: ${updatedPayment[0].id}`)
    }
  } else {
    console.error(`❌ Webhook: No payment record found for payment intent: ${paymentIntent.id}`)
    throw new Error('Payment record not found - checkout process may have failed')
  }

  // Xero integration is now handled entirely by the payment completion processor
  // This ensures consistent handling of staging records, emails, and batch sync

  // Trigger payment completion processor for emails and post-processing
  console.log('🔄 About to trigger payment completion processor...')
  console.log('🔄 Webhook context:', {
    paymentIntentId: paymentIntent.id,
    userId,
    membershipId,
    durationMonths,
    membershipRecordId: membershipRecord.id,
    updatedPaymentId: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
    amount: paymentIntent.amount
  })

  try {
    console.log('🔄 Payment completion processor parameters:', {
      event_type: 'user_memberships',
      record_id: membershipRecord.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_membership'
    })

    console.log('🔄 Calling paymentProcessor.processPaymentCompletion...')
    const processorResult = await paymentProcessor.processPaymentCompletion({
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
    console.log('✅ Payment completion processor returned successfully:', processorResult)
    console.log('✅ Triggered payment completion processor for membership')
  } catch (processorError) {
    console.error('❌ Failed to trigger payment completion processor for membership:', processorError)
    console.error('❌ Processor error details:', {
      message: processorError instanceof Error ? processorError.message : String(processorError),
      stack: processorError instanceof Error ? processorError.stack : undefined
    })
    // Don't fail the webhook - membership was created successfully
  }

  console.log('Successfully processed membership payment intent:', paymentIntent.id)
}

// Handle registration payment processing
async function handleRegistrationPayment(supabase: any, paymentIntent: Stripe.PaymentIntent, userId: string, registrationId: string) {
  // Note: Webhook doesn't have access to categoryId, so we'll need to get it from the registration
  // For now, let's keep the direct database update in webhooks since they're backup/redundancy

  let userRegistration: any

  // First, check if registration already exists and is paid
  const { data: existingPaidRegistration } = await supabase
    .from('user_registrations')
    .select('*')
    .eq('user_id', userId)
    .eq('registration_id', registrationId)
    .eq('payment_status', 'paid')
    .single()

  if (existingPaidRegistration) {
    console.log('Registration already paid, using existing record:', existingPaidRegistration.id)
    userRegistration = existingPaidRegistration
  } else {
    // Update user registration record from awaiting_payment/processing to paid
    const { data: updatedRegistration, error: registrationError } = await supabase
      .from('user_registrations')
      .update({
        payment_status: 'paid',
        registered_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('registration_id', registrationId)
      .in('payment_status', ['awaiting_payment', 'processing'])
      .select()
      .single()

    if (registrationError || !updatedRegistration) {
      console.error('Error updating user registration:', registrationError)
      console.error('Registration update failed for:', { userId, registrationId })

      // Try to find any registration record for debugging
      const { data: allRegistrations } = await supabase
        .from('user_registrations')
        .select('*')
        .eq('user_id', userId)
        .eq('registration_id', registrationId)

      console.error('All registration records found:', allRegistrations)
      throw new Error('Failed to update registration')
    }

    userRegistration = updatedRegistration
  }

  // Record discount usage if discount was applied
  const discountCode = paymentIntent.metadata.discountCode
  const discountAmount = parseInt(paymentIntent.metadata.discountAmount || '0')
  const discountCategoryId = paymentIntent.metadata.discountCategoryId

  if (discountCode && discountAmount > 0 && discountCategoryId) {
    // Get the discount code ID
    const { data: discountCodeRecord } = await supabase
      .from('discount_codes')
      .select('id')
      .eq('code', discountCode)
      .single()

    if (discountCodeRecord) {
      // Get season ID from registration
      const { data: registration } = await supabase
        .from('registrations')
        .select('season_id')
        .eq('id', registrationId)
        .single()

      if (registration) {
        // Check if discount usage already exists to prevent duplicates
        const { data: existingUsage } = await supabase
          .from('discount_usage')
          .select('id')
          .eq('user_id', userId)
          .eq('discount_code_id', discountCodeRecord.id)
          .eq('registration_id', registrationId)
          .single()

        if (!existingUsage) {
          // Record discount usage only if it doesn't already exist
          const { error: usageError } = await supabase
            .from('discount_usage')
            .insert({
              user_id: userId,
              discount_code_id: discountCodeRecord.id,
              discount_category_id: discountCategoryId,
              season_id: registration.season_id,
              amount_saved: discountAmount,
              registration_id: registrationId,
            })

          if (usageError) {
            console.error('Error recording discount usage:', usageError)
            // Don't fail the payment - just log the error
          } else {
            console.log('✅ Recorded discount usage for payment intent:', paymentIntent.id)
          }
        } else {
          console.log('ℹ️ Discount usage already recorded for payment intent:', paymentIntent.id)
        }
      }
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
    console.error('❌ Webhook: Error updating payment record:', paymentUpdateError)
    throw new Error('Failed to update payment record')
  } else if (updatedPayment && updatedPayment.length > 0) {
    console.log(`✅ Webhook: Updated payment record to completed: ${updatedPayment[0].id} (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`)

    // Update user_registrations record with payment_id
    const { error: registrationUpdateError } = await supabase
      .from('user_registrations')
      .update({ payment_id: updatedPayment[0].id })
      .eq('id', userRegistration.id)

    if (registrationUpdateError) {
      console.error('❌ Webhook: Error updating registration record with payment_id:', registrationUpdateError)
    } else {
      console.log(`✅ Webhook: Updated registration record with payment_id: ${updatedPayment[0].id}`)
    }
  } else {
    console.error(`❌ Webhook: No payment record found for payment intent: ${paymentIntent.id}`)
    throw new Error('Payment record not found - checkout process may have failed')
  }

  // Xero integration is now handled entirely by the payment completion processor
  // This ensures consistent handling of staging records, emails, and batch sync

  // Trigger payment completion processor for emails and post-processing
  console.log('🔄 About to trigger payment completion processor for registration...')
  console.log('🔄 Registration webhook context:', {
    paymentIntentId: paymentIntent.id,
    userId,
    registrationId,
    userRegistrationId: userRegistration.id,
    updatedPaymentId: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
    amount: paymentIntent.amount
  })

  try {
    console.log('🔄 Registration payment completion processor parameters:', {
      event_type: 'user_registrations',
      record_id: userRegistration.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_registration'
    })

    console.log('🔄 Calling paymentProcessor.processPaymentCompletion for registration...')
    const processorResult = await paymentProcessor.processPaymentCompletion({
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
    console.log('✅ Registration payment completion processor returned successfully:', processorResult)
    console.log('✅ Triggered payment completion processor for registration')
  } catch (processorError) {
    console.error('❌ Failed to trigger payment completion processor for registration:', processorError)
    console.error('❌ Registration processor error details:', {
      message: processorError instanceof Error ? processorError.message : String(processorError),
      stack: processorError instanceof Error ? processorError.stack : undefined
    })
    // Don't fail the webhook - registration was processed successfully
  }

  console.log('Successfully processed registration payment intent:', paymentIntent.id)
}

// Handle charge updated events (when balance transaction becomes available)
async function handleChargeUpdated(supabase: any, charge: Stripe.Charge) {
  try {
    console.log('🔄 Processing charge updated event for fee update...')

    // Get the payment record by payment intent ID
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
    if (!paymentIntentId) {
      console.log('⚠️ No payment intent ID found in charge')
      return
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single()

    if (paymentError || !payment) {
      console.log('⚠️ No payment record found for charge update:', paymentIntentId)
      return
    }

    // Get the balance transaction to retrieve the fee
    const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction as string)

    if (!balanceTransaction || !balanceTransaction.fee) {
      console.log('⚠️ No fee found in balance transaction:', charge.balance_transaction)
      return
    }

    const feeAmount = balanceTransaction.fee
    console.log(`💰 Found fee in balance transaction: $${(feeAmount / 100).toFixed(2)}`)

    // Update the payment record with the fee
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        stripe_fee_amount: feeAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id)

    if (updateError) {
      console.error('❌ Error updating payment with fee:', updateError)
      return
    }

    console.log(`✅ Updated payment ${payment.id} with fee: $${(feeAmount / 100).toFixed(2)}`)
    console.log('✅ Successfully processed charge updated event - fee updated in database')

  } catch (error) {
    console.error('❌ Error processing charge updated event:', error)
  }
}


// Handle charge refunded events
async function handleChargeRefunded(supabase: any, charge: Stripe.Charge) {
  try {
    console.log('🔄 Processing charge refunded event...')

    // Get the payment record by payment intent ID
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null

    if (!paymentIntentId) {
      console.log('⚠️ No payment intent ID found in refunded charge')
      return
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single()

    if (paymentError || !payment) {
      console.log('⚠️ No payment record found for refunded charge:', paymentIntentId)
      return
    }

    console.log(`💰 Processing refunds for payment ${payment.id}, charge ${charge.id}`)

    // Process each refund in the charge
    if (charge.refunds && charge.refunds.data) {
      for (const stripeRefund of charge.refunds.data) {
        console.log(`💰 Processing refund ${stripeRefund.id} for amount: $${(stripeRefund.amount / 100).toFixed(2)}`)

        // Check if we already have this refund in our database
        const { data: existingRefund } = await supabase
          .from('refunds')
          .select('*')
          .eq('stripe_refund_id', stripeRefund.id)
          .single()

        if (existingRefund) {
          console.log(`✅ Refund ${stripeRefund.id} already exists in database`)

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

            console.log(`✅ Updated refund ${existingRefund.id} status to completed`)
          }

          // NEW ARCHITECTURE: Check for staging_id in Stripe metadata
          const stagingId = stripeRefund.metadata?.staging_id
          if (stagingId) {
            console.log(`🔄 Found staging_id ${stagingId} in metadata, updating staging records to pending`)

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

            console.log(`✅ Updated staging records ${stagingId} to pending status`)

            // Process discount usage for refund line items
            await processRefundDiscountUsage(stagingId, existingRefund.id, payment.id, payment.user_id)

            // Send refund notification email
            await sendRefundNotificationEmail(existingRefund.id, payment.user_id, payment.id)
          } else {
            // EXTERNAL REFUND: No staging_id means this was processed outside our system
            console.log(`⚠️ No staging_id found for refund ${existingRefund.id} - this was likely processed externally`)

            // Log alert for manual intervention at ERROR level for Sentry reporting
            logger.logSystem('external-refund-detected', 'External refund requires manual Xero credit note creation', {
              refundId: existingRefund.id,
              stripeRefundId: stripeRefund.id,
              paymentId: payment.id,
              amount: stripeRefund.amount,
              source: 'external_stripe_refund',
              action_required: 'Manual Xero credit note creation needed'
            }, 'error')

            console.log(`🚨 MANUAL INTERVENTION REQUIRED: External refund ${stripeRefund.id} detected - admin must manually create Xero credit note`)
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
          console.error(`❌ Error creating refund record for ${stripeRefund.id}:`, refundError)
          continue
        }

        console.log(`✅ Created refund record ${newRefund.id} for Stripe refund ${stripeRefund.id}`)

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

        console.log(`🚨 EXTERNAL REFUND ALERT: Refund ${stripeRefund.id} was processed outside our system - manual Xero credit note creation required`)
      }
    }

    // Check if payment should be marked as refunded
    const { data: allRefunds } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', payment.id)
      .eq('status', 'completed')

    const totalRefunded = allRefunds?.reduce((sum: number, refund: any) => sum + refund.amount, 0) || 0

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

      console.log(`✅ Updated payment ${payment.id} status to refunded (total refunded: $${(totalRefunded / 100).toFixed(2)})`)
    }

    console.log('✅ Successfully processed charge refunded event')

  } catch (error) {
    console.error('❌ Error processing charge refunded event:', error)
  }
}

// Helper function to process discount usage for refund line items
async function processRefundDiscountUsage(stagingId: string, refundId: string, paymentId: string, userId: string) {
  try {
    const supabase = createAdminClient()

    // Get refund line items with discount information
    const { data: refundLineItems } = await supabase
      .from('xero_invoice_line_items')
      .select(`
        line_amount,
        line_item_type,
        discount_code_id,
        discount_codes (
          id,
          discount_category_id
        )
      `)
      .eq('xero_invoice_id', stagingId)
      .eq('line_item_type', 'discount')
      .not('discount_code_id', 'is', null)

    if (!refundLineItems || refundLineItems.length === 0) {
      console.log(`No discount line items found for refund staging ${stagingId}`)
      return
    }

    // Get registration data for season context
    const { data: registrationData } = await supabase
      .from('user_registrations')
      .select(`
        registration_id,
        registrations!inner (
          season_id
        )
      `)
      .eq('payment_id', paymentId)
      .limit(1)
      .single()

    if (!registrationData) {
      console.log(`No registration found for payment ${paymentId}`)
      return
    }

    // Process each discount line item
    for (const lineItem of refundLineItems) {
      // Line item amounts already have correct signs:
      // - Positive for discount code refunds (uses more capacity)
      // - Negative for proportional refunds with original discounts (gives back capacity)
      const amountSaved = lineItem.line_amount
      const discountCategoryId = lineItem.discount_codes?.[0]?.discount_category_id

      if (amountSaved > 0) {
        // SCENARIO 1: Discount code refund - INSERT new record
        const { error: insertError } = await supabase
          .from('discount_usage')
          .insert({
            user_id: userId,
            discount_code_id: lineItem.discount_code_id,
            discount_category_id: discountCategoryId,
            season_id: registrationData.registrations[0]?.season_id,
            amount_saved: amountSaved,
            registration_id: registrationData.registration_id,
            used_at: new Date().toISOString()
          })

        if (insertError) {
          console.error(`❌ Error inserting discount usage for refund:`, insertError)
        } else {
          console.log(`✅ Inserted discount usage for discount code refund:`, {
            userId,
            discountCodeId: lineItem.discount_code_id,
            discountCategoryId,
            seasonId: registrationData.registrations[0]?.season_id,
            amountSaved
          })
        }

      } else if (amountSaved < 0) {
        // SCENARIO 2: Proportional refund reversing original discount - UPDATE existing record
        // First, fetch the current amount_saved
        const { data: usageRecord, error: fetchError } = await supabase
          .from('discount_usage')
          .select('id, amount_saved')
          .eq('user_id', userId)
          .eq('discount_category_id', discountCategoryId)
          .eq('season_id', registrationData.registrations[0]?.season_id)
          .single();

        if (fetchError || !usageRecord) {
          console.error(`❌ Error fetching discount usage for proportional refund:`, fetchError);
        } else {
          const newAmountSaved = (usageRecord.amount_saved || 0) + amountSaved;
          const { error: updateError } = await supabase
            .from('discount_usage')
            .update({
              amount_saved: newAmountSaved
            })
            .eq('id', usageRecord.id);

          if (updateError) {
            console.error(`❌ Error updating discount usage for proportional refund:`, updateError);
          } else {
            console.log(`✅ Updated discount usage for proportional refund reversal:`, {
              userId,
              discountCategoryId,
              seasonId: registrationData.registrations[0]?.season_id,
              amountAdjustment: amountSaved
            });
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Error processing refund discount usage:', error)
    // Don't throw - we don't want to fail the entire webhook for this
  }
}

// Helper function to send refund notification email
async function sendRefundNotificationEmail(refundId: string, userId: string, paymentId: string) {
  try {
    const supabase = createAdminClient()

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      console.error(`❌ Failed to fetch user details for refund email:`, userError)
      return
    }

    // Get refund details
    const { data: refund, error: refundError } = await supabase
      .from('refunds')
      .select('amount, reason, created_at')
      .eq('id', refundId)
      .single()

    if (refundError || !refund) {
      console.error(`❌ Failed to fetch refund details for email:`, refundError)
      return
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('final_amount, completed_at, created_at')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      console.error(`❌ Failed to fetch payment details for refund email:`, paymentError)
      return
    }

    // Get original invoice number for better user experience
    const { data: invoice } = await supabase
      .from('xero_invoices')
      .select('invoice_number')
      .eq('payment_id', paymentId)
      .eq('invoice_type', 'ACCREC')
      .single()

    const invoiceNumber = invoice?.invoice_number || `PAY-${paymentId.slice(0, 8)}`

    // Send the refund notification using the existing email service
    await emailService.sendRefundNotification({
      userId: userId,
      email: user.email,
      userName: `${user.first_name} ${user.last_name}`,
      refundAmount: refund.amount,
      originalAmount: payment.final_amount,
      reason: refund.reason,
      paymentDate: formatDate(new Date(payment.completed_at || payment.created_at)),
      invoiceNumber: invoiceNumber,
      refundDate: formatDate(new Date(refund.created_at))
    })

    console.log(`✅ Sent refund notification email to ${user.email} for refund ${refundId}`)

  } catch (error) {
    console.error('❌ Error sending refund notification email:', error)
    // Don't throw - we don't want to fail the entire webhook for this
  }
}

export async function POST(request: NextRequest) {
  // Log webhook receipt immediately for debugging
  try {
    console.log('🔄 Webhook POST request received')
  } catch (logError) {
    console.error('❌ Failed to log webhook receipt:', logError)
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret)

    // Log webhook event immediately after signature verification
    console.log('🔄 Webhook event received:', {
      type: event.type,
      id: event.id,
      created: event.created,
      dataObjectId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown'
    })
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createAdminClient()
    console.log('✅ Database connection created successfully')
  } catch (dbError) {
    console.error('❌ Failed to create database connection:', dbError)
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
  }

  try {



    switch (event.type) {


      case 'charge.updated': {
        const charge = event.data.object as Stripe.Charge

        console.log('🔍 Charge updated webhook received:', {
          chargeId: charge.id,
          paymentIntentId: charge.payment_intent,
          hasBalanceTransaction: !!charge.balance_transaction,
          balanceTransactionId: charge.balance_transaction
        })

        // Only process if balance transaction is now available
        if (charge.balance_transaction && typeof charge.balance_transaction === 'string') {
          await handleChargeUpdated(supabase, charge)
        } else {
          console.log('⚠️ Charge updated but no balance transaction available yet:', {
            chargeId: charge.id,
            balanceTransaction: charge.balance_transaction,
            balanceTransactionType: typeof charge.balance_transaction
          })
        }
        break
      }



      case 'charge.refunded': {
        // Retrieve the charge with expanded refunds data
        const chargeId = (event.data.object as Stripe.Charge).id
        const charge = await stripe.charges.retrieve(chargeId, {
          expand: ['refunds']
        })

        console.log('🔍 Charge refunded webhook received:', {
          chargeId: charge.id,
          paymentIntentId: charge.payment_intent,
          refunds: charge.refunds?.data?.length || 0,
          refundIds: charge.refunds?.data?.map(r => r.id) || []
        })

        await handleChargeRefunded(supabase, charge)
        break
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent

        console.log('🔄 Processing setup_intent.succeeded:', {
          setupIntentId: setupIntent.id,
          status: setupIntent.status,
          paymentMethodId: setupIntent.payment_method,
          metadata: setupIntent.metadata
        })

        const userId = setupIntent.metadata?.supabase_user_id || setupIntent.metadata?.userId
        if (!userId) {
          console.error('❌ Setup Intent missing userId in metadata:', setupIntent.id)
          break
        }

        if (!setupIntent.payment_method) {
          console.error('❌ Setup Intent missing payment method:', setupIntent.id)
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
            console.error('❌ Failed to update user with payment method:', updateError)
            throw updateError
          }

          console.log('✅ Successfully updated user with payment method:', {
            userId,
            setupIntentId: setupIntent.id,
            paymentMethodId: setupIntent.payment_method
          })
        } catch (error) {
          console.error('❌ Error processing setup_intent.succeeded:', error)
          throw error
        }
        break
      }

      
      case 'setup_intent.setup_failed': {
        const setupIntent = event.data.object as Stripe.SetupIntent

        console.log('🔄 Processing setup_intent.setup_failed:', {
          setupIntentId: setupIntent.id,
          status: setupIntent.status,
          lastSetupError: setupIntent.last_setup_error,
          metadata: setupIntent.metadata
        })

        const userId = setupIntent.metadata?.userId
        if (!userId) {
          console.error('❌ Setup Intent missing userId in metadata:', setupIntent.id)
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
            console.error('❌ Failed to update user with failed setup status:', updateError)
            throw updateError
          }

          console.log('✅ Successfully updated user with failed setup status:', {
            userId,
            setupIntentId: setupIntent.id
          })
        } catch (error) {
          console.error('❌ Error processing setup_intent.setup_failed:', error)
          throw error
        }
        break
      }

      case 'payment_method.detached': {
        const paymentMethod = event.data.object as Stripe.PaymentMethod

        console.log('🔄 Processing payment_method.detached:', {
          paymentMethodId: paymentMethod.id,
          customerId: paymentMethod.customer
        })

        try {
          // Find user with this payment method and clean up
          const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email')
            .eq('stripe_payment_method_id', paymentMethod.id)
            .single()

          if (userError || !user) {
            console.log('ℹ️ No user found with this payment method, skipping cleanup')
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
            console.error('❌ Failed to update user after payment method detachment:', updateError)
            throw updateError
          }

          // Remove user from all alternate registrations
          const { error: alternateRemovalError } = await supabase
            .from('user_alternate_registrations')
            .delete()
            .eq('user_id', user.id)

          if (alternateRemovalError) {
            console.error('❌ Failed to remove user from alternate registrations:', alternateRemovalError)
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
                paymentMethod: `****${lastFourDigits}`
              }
            })
          }

          console.log('✅ Successfully cleaned up user data after payment method detachment:', {
            userId: user.id,
            paymentMethodId: paymentMethod.id
          })
        } catch (error) {
          console.error('❌ Error processing payment_method.detached:', error)
          throw error
        }
        break
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        // Check if this is a waitlist selection payment
        if (paymentIntent.metadata?.purpose === 'waitlist_selection') {
          console.log('🔄 Processing waitlist selection payment:', {
            paymentIntentId: paymentIntent.id,
            userId: paymentIntent.metadata.userId,
            registrationId: paymentIntent.metadata.registrationId
          })

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
              console.error('❌ Failed to update waitlist payment record:', paymentUpdateError)
              throw paymentUpdateError || new Error('No payment record found')
            }
            console.log(`✅ Successfully updated waitlist payment record (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`)

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
              console.warn('⚠️ Waitlist registration record not found - may have been created after webhook')
            } else {
              console.log('✅ Verified waitlist registration record exists')
            }

            // Process through payment completion processor for Xero updates and emails
            try {
              console.log('🔄 Triggering payment completion processor for waitlist selection...')
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
              console.log('✅ Successfully processed waitlist selection payment completion')
            } catch (processorError) {
              console.error('❌ Payment completion processor failed for waitlist selection:', processorError)
              // Don't throw - payment succeeded, this is just post-processing
            }
          } catch (error) {
            console.error('❌ Error processing waitlist payment_intent.succeeded:', error)
            throw error
          }

          return NextResponse.json({ received: true })
        }

        // Check if this is an alternate payment
        if (paymentIntent.metadata?.purpose === 'alternate_selection') {
          console.log('🔄 Processing alternate selection payment:', {
            paymentIntentId: paymentIntent.id,
            userId: paymentIntent.metadata.userId,
            registrationId: paymentIntent.metadata.registrationId,
            gameDescription: paymentIntent.metadata.gameDescription
          })

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
              console.error('❌ Failed to update alternate payment record:', paymentUpdateError)
              throw paymentUpdateError || new Error('No payment record found')
            }
            console.log(`✅ Successfully updated alternate payment record (Stripe fee: $${(stripeFeeAmount / 100).toFixed(2)})`)

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
                console.error('❌ Failed to create/update alternate selection record in webhook:', selectionError)
              } else {
                console.log('✅ Successfully ensured alternate selection record exists')
              }
            } else {
              console.warn('⚠️ No gameId in payment metadata - cannot create alternate selection record')
            }

            // Process through payment completion processor for Xero updates and emails
            try {
              console.log('🔄 Triggering payment completion processor for alternate selection...')
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
              console.log('✅ Successfully processed alternate selection payment completion')
            } catch (processorError) {
              console.error('❌ Payment completion processor failed for alternate selection:', processorError)
              // Don't throw - payment succeeded, this is just post-processing
            }
          } catch (error) {
            console.error('❌ Error processing alternate payment_intent.succeeded:', error)
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
          console.error('❌ Payment intent missing required metadata:', {
            paymentIntentId: paymentIntent.id,
            hasUserId: !!userId,
            hasMembershipId: !!membershipId,
            hasRegistrationId: !!registrationId,
            hasDurationMonths: !!durationMonths,
            allMetadata: paymentIntent.metadata
          })
        }
        break
      }

      case 'payment_intent.payment_failed': {
        // Check if this is an alternate payment
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        if (paymentIntent.metadata?.purpose === 'alternate_selection') {
          console.log('🔄 Processing failed alternate selection payment:', {
            paymentIntentId: paymentIntent.id,
            userId: paymentIntent.metadata.userId,
            registrationId: paymentIntent.metadata.registrationId,
            gameDescription: paymentIntent.metadata.gameDescription
          })

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
              console.error('❌ Failed to update failed alternate payment record:', paymentUpdateError)
              throw paymentUpdateError
            }

            // TODO: Send notification to captain and alternate about failed payment
            // This could be handled by the payment completion processor

            console.log('✅ Successfully updated failed alternate payment record')
          } catch (error) {
            console.error('❌ Error processing failed alternate payment:', error)
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
          console.log('🔓 Releasing registration reservation after payment failure:', {
            userId,
            registrationId,
            paymentIntentId: paymentIntent.id
          })

          await supabase
            .from('user_registrations')
            .update({
              payment_status: 'failed',
              reservation_expires_at: null // Release the reservation immediately
            })
            .eq('user_id', userId)
            .eq('registration_id', registrationId)
            .eq('payment_status', 'awaiting_payment') // Only update if still awaiting payment

          console.log('✅ Registration reservation released')
        }

        // Clean up draft invoice if it exists
        try {
          const invoiceNumber = paymentIntent.metadata.invoiceNumber
          const xeroInvoiceId = paymentIntent.metadata.xeroInvoiceId

          if (invoiceNumber && xeroInvoiceId) {
            console.log(`🗑️ Cleaning up draft invoice ${invoiceNumber} after payment failure`)

            // Delete the draft invoice from Xero
            const deleteResult = await deleteXeroDraftInvoice(xeroInvoiceId)

            if (deleteResult.success) {
              // Delete the draft invoice from our database
              await supabase
                .from('xero_invoices')
                .delete()
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('sync_status', 'pending') // Only delete if still pending

              console.log(`✅ Fully cleaned up draft invoice ${invoiceNumber} after payment failure`)
            } else {
              console.warn(`⚠️ Failed to delete invoice from Xero: ${deleteResult.error}`)
              // Still clean up our database tracking even if Xero deletion fails
              await supabase
                .from('xero_invoices')
                .delete()
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('sync_status', 'pending')
            }
          }
        } catch (cleanupError) {
          console.error('⚠️ Error cleaning up draft invoice after payment failure:', cleanupError)
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
              console.log('✅ Triggered payment completion processor for failed payment')
            }
          }
        } catch (processorError) {
          console.error('❌ Failed to trigger payment completion processor for failed payment:', processorError)
          // Don't fail the webhook - payment failure was already recorded
        }

        if (!userId) {
          console.error('❌ Failed payment intent missing required metadata:', {
            paymentIntentId: paymentIntent.id,
            hasUserId: !!userId,
            hasMembershipId: !!membershipId,
            hasRegistrationId: !!registrationId,
            allMetadata: paymentIntent.metadata
          })
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    console.error('Webhook error details:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      eventType: event.type,
      paymentIntentId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown'
    })

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