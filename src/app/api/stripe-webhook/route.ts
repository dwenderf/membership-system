import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { calculateMembershipStartDate, calculateMembershipEndDate } from '@/lib/membership-utils'
import { deleteXeroDraftInvoice } from '@/lib/xero/invoices'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { logger } from '@/lib/logging/logger'

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
  apiVersion: '2025-05-28.basil',
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

    const startDate = calculateMembershipStartDate(membershipId, userMemberships || [])
    const endDate = calculateMembershipEndDate(startDate, durationMonths)

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
        charge_id: chargeId || undefined
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
        charge_id: chargeId || undefined
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

// Create staging record for credit note in xero_invoices table
async function stageCreditNoteForXero(supabase: any, refundId: string, paymentId: string, refundAmount: number): Promise<boolean> {
  try {
    console.log(`🔄 Staging credit note for refund ${refundId}`)
    
    // Get payment details for staging metadata
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        *,
        users!payments_user_id_fkey (
          id,
          first_name,
          last_name,
          member_id,
          email
        )
      `)
      .eq('id', paymentId)
      .single()
    
    if (paymentError || !payment) {
      console.error(`❌ Failed to get payment details for staging: ${paymentError?.message}`)
      return false
    }
    
    // Get original invoice line items to build credit note line items
    const { data: originalInvoice, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select(`
        *,
        xero_invoice_line_items (
          description,
          line_amount,
          account_code,
          tax_type,
          line_item_type
        )
      `)
      .eq('payment_id', paymentId)
      .single()
    
    let lineItems = []
    if (originalInvoice?.xero_invoice_line_items) {
      // Proportionally allocate refund across original line items
      const totalInvoiceAmount = originalInvoice.xero_invoice_line_items.reduce((sum: number, item: any) => sum + item.line_amount, 0)
      
      lineItems = originalInvoice.xero_invoice_line_items.map((item: any) => {
        const proportion = Math.abs(item.line_amount) / totalInvoiceAmount
        const creditAmount = Math.round(refundAmount * proportion)
        
        return {
          description: `Refund: ${item.description}`,
          line_amount: creditAmount,
          account_code: item.account_code,
          tax_type: item.tax_type || 'NONE',
          line_item_type: item.line_item_type || 'sales'
        }
      })
      
      // Ensure total matches exactly (handle rounding differences)
      const totalAllocated = lineItems.reduce((sum: number, item: any) => sum + item.line_amount, 0)
      const difference = refundAmount - totalAllocated
      
      if (difference !== 0 && lineItems.length > 0) {
        const largestItem = lineItems.reduce((max: any, item: any) => 
          item.line_amount > max.line_amount ? item : max
        )
        largestItem.line_amount += difference
      }
    } else {
      // Fallback: create generic refund line item
      lineItems = [{
        description: `Refund for Payment ${paymentId.slice(0, 8)}`,
        line_amount: refundAmount,
        account_code: '400', // Default sales account
        tax_type: 'NONE',
        line_item_type: 'sales'
      }]
    }
    
    // Create staging record in xero_invoices table
    const { data: stagingRecord, error: stagingError } = await supabase
      .from('xero_invoices')
      .insert({
        payment_id: paymentId,
        tenant_id: null, // Will be populated during sync
        xero_invoice_id: null, // Will be populated when synced to Xero
        invoice_number: null, // Let Xero generate the number
        invoice_type: 'ACCRECCREDIT', // Credit note type
        invoice_status: 'AUTHORISED',
        total_amount: refundAmount,
        discount_amount: 0,
        net_amount: refundAmount,
        stripe_fee_amount: 0,
        sync_status: 'pending', // Ready for sync
        staged_at: new Date().toISOString(),
        staging_metadata: {
          refund_id: refundId,
          user_id: payment.user_id,
          refund_amount: refundAmount,
          credit_note_type: 'refund',
          reason: `Refund for Payment ${paymentId.slice(0, 8)}`,
          stripe_refund_data: {
            created_at: new Date().toISOString()
          },
          line_items: lineItems,
          contact_info: {
            user_id: payment.user_id,
            first_name: payment.users?.first_name,
            last_name: payment.users?.last_name,
            member_id: payment.users?.member_id,
            email: payment.users?.email
          }
        }
      })
      .select()
      .single()
    
    if (stagingError) {
      console.error(`❌ Failed to create credit note staging record: ${stagingError.message}`)
      return false
    }
    
    // Create line items for the credit note
    if (lineItems.length > 0) {
      const { error: lineItemsError } = await supabase
        .from('xero_invoice_line_items')
        .insert(
          lineItems.map((item, index) => ({
            xero_invoice_id: stagingRecord.id,
            description: item.description,
            quantity: 1,
            unit_amount: Math.abs(item.line_amount) / 100, // Convert to dollars, ensure positive for credit
            line_amount: item.line_amount,
            account_code: item.account_code,
            tax_type: item.tax_type,
            line_item_type: item.line_item_type,
            line_order: index + 1
          }))
        )
      
      if (lineItemsError) {
        console.error(`❌ Failed to create credit note line items: ${lineItemsError.message}`)
        // Clean up the staging record if line items failed
        await supabase
          .from('xero_invoices')
          .delete()
          .eq('id', stagingRecord.id)
        return false
      }
    }
    
    console.log(`✅ Created credit note staging record ${stagingRecord.id} for refund ${refundId}`)
    
    // Get Stripe bank account code for payment staging
    const { data: stripeAccountCode, error: accountError } = await supabase
      .from('system_accounting_codes')
      .select('accounting_code')
      .eq('code_type', 'stripe_bank_account')
      .single()
    
    const bankAccountCode = stripeAccountCode?.accounting_code || '090' // Fallback
    
    if (accountError || !stripeAccountCode?.accounting_code) {
      console.warn(`⚠️ Using fallback bank account code (090) for credit note payment. Error: ${accountError?.message}`)
    }
    
    // Create corresponding payment record for the refund (negative amount = money going out)
    const { data: paymentStaging, error: paymentStagingError } = await supabase
      .from('xero_payments')
      .insert({
        xero_invoice_id: stagingRecord.id, // Links to the credit note record
        tenant_id: null, // Will be populated during sync
        xero_payment_id: null, // Will be populated when synced to Xero
        payment_method: 'stripe',
        bank_account_code: bankAccountCode,
        amount_paid: -Math.abs(refundAmount), // Negative amount = money going OUT
        stripe_fee_amount: 0, // Refunds don't have additional Stripe fees
        reference: `Refund ${refundId.slice(0, 8)}`,
        sync_status: 'pending', // Ready for sync (refund is confirmed by webhook)
        staged_at: new Date().toISOString(),
        staging_metadata: {
          refund_id: refundId,
          payment_id: paymentId,
          refund_type: 'stripe_refund',
          refund_amount: refundAmount,
          stripe_refund_data: {
            created_at: new Date().toISOString()
          },
          credit_note_id: stagingRecord.id
        }
      })
      .select()
      .single()
    
    if (paymentStagingError) {
      console.error(`❌ Failed to create credit note payment staging record: ${paymentStagingError.message}`)
      // Clean up the credit note staging record if payment failed
      await supabase
        .from('xero_invoices')
        .delete()
        .eq('id', stagingRecord.id)
      return false
    }
    
    console.log(`✅ Created credit note payment staging record ${paymentStaging.id} for refund ${refundId}`)
    return true
    
  } catch (error) {
    console.error(`❌ Error staging credit note for refund ${refundId}:`, error)
    return false
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
            
            // Stage credit note for Xero sync instead of direct API call
            const stagingSuccess = await stageCreditNoteForXero(supabase, existingRefund.id, existingRefund.payment_id, existingRefund.amount)
            if (!stagingSuccess) {
              console.error(`❌ Failed to stage credit note for refund ${existingRefund.id}`)
            }
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
        
        // Stage credit note for Xero sync instead of direct API call
        const stagingSuccess = await stageCreditNoteForXero(supabase, newRefund.id, newRefund.payment_id, newRefund.amount)
        if (!stagingSuccess) {
          console.error(`❌ Failed to stage credit note for external refund ${newRefund.id}`)
        }
        
        // Log the refund for audit trail
        logger.logSystem('refund-webhook-processed', 'Refund processed via webhook', {
          refundId: newRefund.id,
          stripeRefundId: stripeRefund.id,
          paymentId: payment.id,
          amount: stripeRefund.amount,
          reason: refundReason,
          source: 'stripe_webhook'
        })
      }
    }
    
    // Check if payment should be marked as refunded
    const { data: allRefunds } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', payment.id)
      .eq('status', 'completed')
    
    const totalRefunded = allRefunds?.reduce((sum, refund) => sum + refund.amount, 0) || 0
    
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
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Debug: Log all metadata to see what we're receiving
        console.log('🔍 Payment intent metadata received:', {
          paymentIntentId: paymentIntent.id,
          amount: paymentIntent.amount,
          status: paymentIntent.status,
          allMetadata: paymentIntent.metadata
        })
        
        // Extract metadata
        const userId = paymentIntent.metadata.userId
        const membershipId = paymentIntent.metadata.membershipId
        const registrationId = paymentIntent.metadata.registrationId
        const durationMonths = paymentIntent.metadata.durationMonths ? parseInt(paymentIntent.metadata.durationMonths) : null

        // Handle membership payment
        if (userId && membershipId && durationMonths && !isNaN(durationMonths)) {
          await handleMembershipPayment(supabase, supabase, paymentIntent, userId, membershipId, durationMonths)
        }
        // Handle registration payment  
        else if (userId && registrationId) {
          await handleRegistrationPayment(supabase, paymentIntent, userId, registrationId)
        }
        else {
          console.error('❌ Missing required metadata in payment intent:', paymentIntent.id, {
            userId,
            membershipId,
            registrationId,
            durationMonths,
            hasDurationMonths: !!paymentIntent.metadata.durationMonths,
            allMetadataKeys: Object.keys(paymentIntent.metadata),
            allMetadata: paymentIntent.metadata
          })
        }
        break
      }
      
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

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Update payment record
        await supabase
          .from('payments')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)

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
          const userId = paymentIntent.metadata.userId
          const membershipId = paymentIntent.metadata.membershipId
          const registrationId = paymentIntent.metadata.registrationId

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

        console.log('Payment failed for payment intent:', paymentIntent.id)
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