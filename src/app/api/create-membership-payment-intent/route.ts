import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { calculateMembershipStartDate, calculateMembershipEndDate } from '@/lib/membership-utils'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager, StagingPaymentData } from '@/lib/xero/staging'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { centsToCents } from '@/types/currency'

// Force import server config

import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess, PaymentContext } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

// Handle free membership purchases (amount = 0)
async function handleFreeMembership({
  supabase,
  user,
  userProfile,
  membership,
  membershipId,
  durationMonths,
  assistanceAmount,
  paymentContext,
  startTime
}: {
  supabase: any
  user: any
  userProfile: any
  membership: any
  membershipId: string
  durationMonths: number
  assistanceAmount?: number
  paymentContext: any
  startTime: number
}) {
  try {
    const adminSupabase = createAdminClient()
    
    // Fetch membership and user details if not provided
    if (!membership) {
      const { data: membershipData, error: membershipError } = await supabase
        .from('memberships')
        .select('*')
        .eq('id', membershipId)
        .single()

      if (membershipError || !membershipData) {
        capturePaymentError(membershipError || new Error('Membership not found'), paymentContext, 'error')
        return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
      }
      membership = membershipData
    }

    if (!userProfile) {
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileError || !profileData) {
        capturePaymentError(profileError || new Error('User profile not found'), paymentContext, 'error')
        return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
      }
      userProfile = profileData
    }

    // Stage Xero records FIRST - fail fast if this fails
    logger.logPaymentProcessing(
      'staging-creation-start',
      'Creating Xero staging record for free membership',
      { 
        userId: user.id, 
        membershipId,
        durationMonths
      },
      'info'
    )

    const membershipAmount = durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths
    


    
    // Get accounting codes from system_accounting_codes (only needed if applying discount)
    const { data: accountingCodes } = await supabase
      .from('system_accounting_codes')
      .select('code_type, accounting_code')
      .in('code_type', ['donation_given_default', 'donation_received_default'])
    
    const discountAccountingCode = accountingCodes?.find((code: { code_type: string; accounting_code: string }) => code.code_type === 'donation_given_default')?.accounting_code

    
    const stagingData: StagingPaymentData = {
      user_id: user.id,
      total_amount: centsToCents(membershipAmount),
      discount_amount: centsToCents(assistanceAmount || 0), // Only discount if not naturally free
      final_amount: centsToCents(0),
      payment_items: [
        {
          item_type: 'membership' as const,
          item_id: membershipId,
          item_amount: centsToCents(membershipAmount), // Use actual membership price (0 if naturally free)
          description: `Membership: ${membership.name} - ${durationMonths} months`,
          accounting_code: membership.accounting_code
        }
      ],
      discount_codes_used: [], // No discount codes for membership - hardcoded codes are treated as donations
      stripe_payment_intent_id: null
    }

    // Add assistance items if applicable (convert positive assistance amount to negative discount)
    if (assistanceAmount && assistanceAmount > 0) {
      stagingData.payment_items.push({
        item_type: 'discount' as const,
        item_id: membershipId,
        item_amount: centsToCents(-assistanceAmount), // Convert to negative for discount
        description: `Donation Given: Financial Assistance - ${membership.name}`,
        accounting_code: discountAccountingCode
      })
    }

    const stagingSuccess = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: true })
    if (!stagingSuccess) {
      logger.logPaymentProcessing(
        'staging-creation-failed',
        'Failed to create Xero staging record for free membership',
        { 
          userId: user.id, 
          membershipId
        },
        'error'
      )
      capturePaymentError(new Error('Failed to stage Xero records'), paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to process purchase - Xero staging failed' }, { status: 500 })
    }

    logger.logPaymentProcessing(
      'staging-creation-success',
      'Successfully created Xero staging record for free membership',
      { 
        userId: user.id, 
        membershipId
      },
      'info'
    )

    // Create payment record with $0 amount and completed status
    const now = new Date().toISOString()
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: 0,
        final_amount: 0,
        stripe_payment_intent_id: null, // No Stripe payment for free
        status: 'completed',
        payment_method: 'free',
        completed_at: now,
      })
      .select()
      .single()

    if (paymentError) {
      capturePaymentError(paymentError, paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to create payment record' }, { status: 500 })
    }

    // Update staging records with payment_id now that we have it
    logger.logPaymentProcessing(
      'staging-payment-link',
      'Linking payment record to staging records',
      { 
        userId: user.id, 
        paymentId: paymentRecord.id,
        membershipId
      },
      'info'
    )

    const { error: stagingUpdateError } = await supabase
      .from('xero_invoices')
      .update({ payment_id: paymentRecord.id })
      .eq('staging_metadata->>user_id', user.id)
      .eq('sync_status', 'staged')
      .is('payment_id', null)

    if (stagingUpdateError) {
      logger.logPaymentProcessing(
        'staging-payment-link-failed',
        'Failed to link payment to staging records',
        { 
          userId: user.id, 
          paymentId: paymentRecord.id,
          error: stagingUpdateError.message
        },
        'error'
      )
      // Don't fail the whole transaction, but log the issue
    }

    // Payment items are now tracked in xero_invoice_line_items via the staging system
    // No need to create separate payment_items records


    // Create the membership record directly (similar to webhook processing)
    const startDate = calculateMembershipStartDate(membershipId, [])
    const endDate = calculateMembershipEndDate(startDate, durationMonths)

    const { data: membershipRecord, error: membershipError } = await supabase
      .from('user_memberships')
      .insert({
        user_id: user.id,
        membership_id: membershipId,
        valid_from: startDate.toISOString().split('T')[0],
        valid_until: endDate.toISOString().split('T')[0],
        months_purchased: durationMonths,
        payment_status: 'paid',
        stripe_payment_intent_id: null,
        amount_paid: 0,
        purchased_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (membershipError || !membershipRecord) {
      capturePaymentError(membershipError || new Error('No membership record returned'), paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 })
    }

    // Update user_memberships record with payment_id
    const { error: membershipUpdateError } = await adminSupabase
      .from('user_memberships')
      .update({ payment_id: paymentRecord.id })
      .eq('id', membershipRecord.id)

    if (membershipUpdateError) {
      logger.logPaymentProcessing(
        'membership-payment-link-failed',
        'Failed to link payment to membership record',
        { 
          userId: user.id, 
          paymentId: paymentRecord.id,
          membershipId: membershipRecord.id,
          error: membershipUpdateError.message
        },
        'error'
      )
      // Don't fail the whole transaction, but log the issue
    }

    // Trigger payment completion processor for emails and post-processing
    try {
      await paymentProcessor.processPaymentCompletion({
        event_type: 'user_memberships',
        record_id: membershipRecord.id,
        user_id: user.id,
        payment_id: paymentRecord.id, // Now we have the payment_id
        amount: 0,
        trigger_source: 'free_membership',
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      // Email staging failures are non-critical - don't fail the transaction
      logger.logPaymentProcessing(
        'free-membership-email-error',
        'Failed to stage confirmation email for free membership',
        { 
          userId: user.id, 
          membershipId,
          membershipRecordId: membershipRecord.id,
          error: error instanceof Error ? error.message : String(error)
        },
        'warn'
      )
    }

    // Log successful operation
    capturePaymentSuccess('free_membership_creation', paymentContext, Date.now() - startTime)

    // Return success without client secret (no Stripe payment needed)
    return NextResponse.json({
      success: true,
      paymentIntentId: null,
      isFree: true,
      message: 'Free membership created successfully - Xero invoice will be created via batch processing'
    })

  } catch (error) {
    logger.logPaymentProcessing(
      'free-membership-error',
      'Error handling free membership',
      { 
        userId: user.id, 
        membershipId,
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    capturePaymentError(error, paymentContext, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Create a membership payment intent
 * 
 * @param membershipId - UUID of the membership to purchase
 * @param durationMonths - Number of months for the membership (1 or 12)
 * @param amountToCharge - Final amount to charge in cents (0 for free memberships)
 * @param paymentOption - Payment type: 'standard', 'assistance', or 'donation'
 * @param assistanceAmount - Amount of financial assistance needed in cents (positive value, e.g., 3000 for $30 discount)
 * @param donationAmount - Additional donation amount in cents (positive value, e.g., 5000 for $50 donation)
 * 
 * @returns Payment intent data including:
 * - clientSecret: Stripe client secret for payment form
 * - total_amount: Original membership price before discounts (for assistance payments) or final amount (for standard payments)
 * - final_amount: Actual amount being charged to the user
 * - discount_amount: Amount of assistance/discount applied (positive value)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { membershipId, durationMonths, amount: amountToCharge, paymentOption, assistanceAmount, donationAmount } = body
    
    // Set payment context for Sentry
    const paymentContext: PaymentContext = {
      userId: user.id,
      userEmail: user.email,
      membershipId: membershipId,
      amountCents: amountToCharge,
      paymentIntentId: undefined, // Will be set after Stripe payment intent creation
      endpoint: '/api/create-membership-payment-intent',
      operation: 'payment_intent_creation'
    }
    setPaymentContext(paymentContext)

    // Validate required fields (amount can be 0 for free memberships)
    if (!membershipId || !durationMonths || amountToCharge === undefined || amountToCharge === null) {
      const error = new Error('Missing required fields: membershipId, durationMonths, amount')
      capturePaymentError(error, paymentContext, 'warning')
      
      return NextResponse.json(
        { error: 'Missing required fields: membershipId, durationMonths, amount' },
        { status: 400 }
      )
    }

    // Handle free membership (amount = 0) - no Stripe payment needed
    if (amountToCharge === 0) {
      return await handleFreeMembership({
        supabase,
        user,
        userProfile: null, // Will fetch in function
        membership: null, // Will fetch in function
        membershipId,
        durationMonths,
        assistanceAmount,
        paymentContext,
        startTime
      })
    }

    // Not a free membership, so we need to create a Stripe payment intent. There can be a donation or assistance amount.
    // If there is a donation amount, we need to create a donation item in the Xero staging record.
    // If there is an assistance amount, we need to create an assistance item in the Xero staging record.
    // If there is both, we need to create both items in the Xero staging record.
    // If there is neither, we need to create a membership item in the Xero staging record.
    // The Xero staging record will be created in the createImmediateStaging function.
    // The Stripe payment intent will be created in the createStripePaymentIntent function.
    
    // Fetch membership details for metadata
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('*')
      .eq('id', membershipId)
      .single()

    if (membershipError || !membership) {
      capturePaymentError(membershipError || new Error('Membership not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    // Fetch user details for customer info
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      capturePaymentError(profileError || new Error('User profile not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Calculate amounts for Xero invoice
    const getMembershipAmount = () => {
      const basePrice = durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths
      return Math.round(basePrice)
    }

    const membershipAmount = getMembershipAmount()
    
    
    // Get accounting codes from system_accounting_codes
    const { data: accountingCodes, error: accountingError } = await supabase
      .from('system_accounting_codes')
      .select('code_type, accounting_code')
      .in('code_type', ['donation_received_default', 'donation_given_default'])
    
    
    const donationAccountingCode = accountingCodes?.find(code => code.code_type === 'donation_received_default')?.accounting_code
    const discountAccountingCode = accountingCodes?.find(code => code.code_type === 'donation_given_default')?.accounting_code

    // Stage Xero records FIRST - fail fast if this fails
    logger.logPaymentProcessing(
      'staging-creation-start',
      'Creating Xero staging record for paid membership',
      { 
        userId: user.id, 
        membershipId,
        durationMonths,
        amount: amountToCharge
      },
      'info'
    )

    const stagingData: StagingPaymentData = {
      user_id: user.id,
      total_amount: centsToCents(paymentOption === 'assistance' ? membershipAmount : amountToCharge),
      discount_amount: centsToCents(paymentOption === 'assistance' ? Math.abs(assistanceAmount || 0) : 0),
      final_amount: centsToCents(amountToCharge),
      payment_items: [
        {
          item_type: 'membership' as const,
          item_id: membershipId,
          item_amount: centsToCents(paymentOption === 'assistance' ? (durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths) : membershipAmount),
          description: `Membership: ${membership.name} - ${durationMonths} months`,
          accounting_code: membership.accounting_code
        }
      ],
      discount_codes_used: [], // No discount codes for membership - hardcoded codes are treated as donations
      stripe_payment_intent_id: null // Will be updated after Stripe intent creation
    }

    // Add donation items if applicable
    if (donationAmount && donationAmount > 0) {
      stagingData.payment_items.push({
        item_type: 'donation' as const,
        item_id: membershipId,
        item_amount: centsToCents(donationAmount),
        description: `Donation Received: ${membership.name}`,         
        accounting_code: donationAccountingCode
      })
    }

    // Add assistance items if applicable (convert positive assistance amount to negative discount)
    if (assistanceAmount && assistanceAmount > 0) {
      stagingData.payment_items.push({
        item_type: 'discount' as const,
        item_id: membershipId,
        item_amount: centsToCents(-assistanceAmount), // Convert to negative for discount
        description: `Donation Given: Financial Assistance - ${membership.name}`,
        accounting_code: discountAccountingCode
      })
    }

    const stagingSuccess = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: false })
    if (!stagingSuccess) {
      logger.logPaymentProcessing(
        'staging-creation-failed',
        'Failed to create Xero staging record for paid membership',
        { 
          userId: user.id, 
          membershipId,
          amount: amountToCharge
        },
        'error'
      )
      capturePaymentError(new Error('Failed to stage Xero records'), paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to process purchase - Xero staging failed' }, { status: 500 })
    }

    logger.logPaymentProcessing(
      'staging-creation-success',
      'Successfully created Xero staging record for paid membership',
      { 
        userId: user.id, 
        membershipId,
        amount: amountToCharge
      },
      'info'
    )

    // Create description for payment intent
    const getDescription = () => {
      const baseName = `${membership.name} - ${durationMonths} months`
      
      switch (paymentOption) {
        case 'assistance':
          return `${baseName} (Financial Assistance)`
        case 'donation':
          return `${baseName} + Donation`
        default:
          return baseName
      }
    }

    // Create payment intent with explicit Link support
    const paymentIntentParams = {
      amount: centsToCents(amountToCharge), // Ensure integer cents for Stripe
      currency: 'usd',
      receipt_email: userProfile.email,
      payment_method_types: ['card', 'link'],
      metadata: {
        userId: user.id,
        membershipId: membershipId,
        membershipName: membership.name,
        durationMonths: durationMonths.toString(),
        userName: `${userProfile.first_name} ${userProfile.last_name}`,
        paymentOption: paymentOption || 'standard',
        ...(paymentOption === 'assistance' && assistanceAmount && { assistanceAmount: assistanceAmount.toString() }),
        ...(paymentOption === 'donation' && donationAmount && { donationAmount: donationAmount.toString() }),
      },
      description: getDescription(),
    }
    
    const paymentIntent = await stripe.paymentIntents.create({
      ...paymentIntentParams,
      shipping: {
        name: `${userProfile.first_name} ${userProfile.last_name}`,
        address: {
          line1: '', // You can add address fields if you collect them
          country: 'US', // Default country
        },
      },
    })

    // Update payment context with payment intent ID
    paymentContext.paymentIntentId = paymentIntent.id

    // Update staging records with Stripe payment intent ID
    logger.logPaymentProcessing(
      'staging-stripe-link',
      'Linking Stripe payment intent to staging records',
      { 
        userId: user.id, 
        paymentIntentId: paymentIntent.id,
        membershipId
      },
      'info'
    )

    // First get the current staging metadata, then update it
    const { data: existingRecord } = await supabase
      .from('xero_invoices')
      .select('staging_metadata')
      .eq('staging_metadata->>user_id', user.id)
      .eq('sync_status', 'staged')
      .is('payment_id', null)
      .single()

    const updatedMetadata = {
      ...existingRecord?.staging_metadata,
      stripe_payment_intent_id: paymentIntent.id
    }

    const { error: stagingStripeUpdateError } = await supabase
      .from('xero_invoices')
      .update({ staging_metadata: updatedMetadata })
      .eq('staging_metadata->>user_id', user.id)
      .eq('sync_status', 'staged')
      .is('payment_id', null)

    if (stagingStripeUpdateError) {
      logger.logPaymentProcessing(
        'staging-stripe-link-failed',
        'Failed to link Stripe payment intent to staging records',
        { 
          userId: user.id, 
          paymentIntentId: paymentIntent.id,
          error: stagingStripeUpdateError.message
        },
        'error'
      )
      // Don't fail the transaction, but log the issue
    }

    const totalAmount = centsToCents(amountToCharge) // Ensure integer cents

    // Create payment record in database
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: totalAmount,
        final_amount: totalAmount,
        stripe_payment_intent_id: paymentIntent.id,
        status: 'pending',
        payment_method: 'stripe',
      })
      .select()
      .single()


    if (paymentError) {
      logger.logPaymentProcessing(
        'payment-record-error',
        'Error creating payment record for paid membership',
        { 
          userId: user.id, 
          membershipId,
          paymentIntentId: paymentIntent.id,
          error: paymentError.message
        },
        'error'
      )
      // Log warning but don't fail the request since Stripe intent was created
      capturePaymentError(paymentError, paymentContext, 'warning')
    } else if (paymentRecord) {
      // Link payment record to staging records
      logger.logPaymentProcessing(
        'staging-payment-link',
        'Linking payment record to staging records',
        { 
          userId: user.id, 
          paymentId: paymentRecord.id,
          paymentIntentId: paymentIntent.id
        },
        'info'
      )

      const { error: stagingPaymentUpdateError } = await supabase
        .from('xero_invoices')
        .update({ payment_id: paymentRecord.id })
        .eq('staging_metadata->>user_id', user.id)
        .eq('sync_status', 'staged')
        .is('payment_id', null)

      if (stagingPaymentUpdateError) {
        logger.logPaymentProcessing(
          'staging-payment-link-failed',
          'Failed to link payment to staging records',
          { 
            userId: user.id, 
            paymentId: paymentRecord.id,
            error: stagingPaymentUpdateError.message
          },
          'error'
        )
        // Don't fail the transaction, but log the issue
      }

      // Also update the xero_payments staging metadata with payment_id
      // First get the invoice ID
      const { data: invoiceData, error: invoiceQueryError } = await supabase
        .from('xero_invoices')
        .select('id')
        .eq('staging_metadata->>user_id', user.id)
        .eq('sync_status', 'staged')
        .eq('payment_id', paymentRecord.id)
        .single()

      if (invoiceQueryError) {
        logger.logPaymentProcessing(
          'xero-invoice-query-failed',
          'Failed to query xero_invoices for payment update',
          { 
            userId: user.id, 
            paymentId: paymentRecord.id,
            error: invoiceQueryError.message
          },
          'warn'
        )
      } else if (invoiceData) {
        const { error: xeroPaymentUpdateError } = await supabase
          .from('xero_payments')
          .update({ 
            staging_metadata: {
              payment_id: paymentRecord.id,
              stripe_payment_intent_id: paymentIntent.id,
              created_at: new Date().toISOString()
            }
          })
          .eq('xero_invoice_id', invoiceData.id)
          .eq('sync_status', 'staged')

        if (xeroPaymentUpdateError) {
          logger.logPaymentProcessing(
            'xero-payment-staging-update-failed',
            'Failed to update xero_payments staging metadata',
            { 
              userId: user.id, 
              paymentId: paymentRecord.id,
              error: xeroPaymentUpdateError.message
            },
            'warn'
          )
          // Don't fail the transaction, but log the issue
        } else {
          logger.logPaymentProcessing(
            'xero-payment-staging-update-success',
            'Successfully updated xero_payments staging metadata',
            { 
              userId: user.id, 
              paymentId: paymentRecord.id
            },
            'info'
          )
        }
      }
    }

    // Payment items are now tracked in xero_invoice_line_items via the staging system
    // No need to create separate payment_items records

    // Log successful operation
    capturePaymentSuccess('payment_intent_creation', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    })
    
  } catch (error) {
    logger.logPaymentProcessing(
      'payment-intent-error',
      'Error creating payment intent',
      { 
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    
    // Capture error in Sentry
    capturePaymentError(error, {
      endpoint: '/api/create-membership-payment-intent',
      operation: 'payment_intent_creation'
    }, 'error')
    
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    )
  }
}