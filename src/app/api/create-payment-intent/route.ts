import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createXeroInvoiceBeforePayment, PrePaymentInvoiceData } from '@/lib/xero-invoices'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager } from '@/lib/xero-staging'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
})

// Handle free membership purchases (amount = 0)
async function handleFreeMembership({
  supabase,
  user,
  userProfile,
  membership,
  membershipId,
  durationMonths,
  paymentOption,
  assistanceAmount,
  donationAmount,
  paymentContext,
  startTime
}: {
  supabase: any
  user: any
  userProfile: any
  membership: any
  membershipId: string
  durationMonths: number
  paymentOption?: string
  assistanceAmount?: number
  donationAmount?: number
  paymentContext: any
  startTime: number
}) {
  try {
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
    
    // Get accounting codes from system_accounting_codes
    const { data: accountingCodes } = await supabase
      .from('system_accounting_codes')
      .select('code_type, accounting_code')
      .in('code_type', ['donation_given_default', 'donation_received_default'])
    
    const discountAccountingCode = accountingCodes?.find(code => code.code_type === 'donation_given_default')?.accounting_code
    const donationAccountingCode = accountingCodes?.find(code => code.code_type === 'donation_received_default')?.accounting_code
    
    const stagingData = {
      user_id: user.id,
      total_amount: membershipAmount,
      discount_amount: membershipAmount, // Full discount for free membership
      final_amount: donationAmount || 0,
      payment_items: [
        {
          item_type: 'membership' as const,
          item_id: membershipId,
          amount: membershipAmount, // Full membership price
          description: `Membership: ${membership.name} - ${durationMonths} months`,
          accounting_code: membership.accounting_code
        }
      ],
      discount_codes_used: [
        {
          code: 'FREE_MEMBERSHIP',
          amount_saved: membershipAmount,
          category_name: 'Free Membership Discount',
          accounting_code: discountAccountingCode
        }
      ],
      stripe_payment_intent_id: null
    }

    // Add donation item if applicable
    if (paymentOption === 'donation' && donationAmount && donationAmount > 0) {
      stagingData.payment_items.push({
        item_type: 'donation' as const,
        item_id: membershipId,
        amount: donationAmount,
        description: `Donation - ${membership.name}`,
        accounting_code: donationAccountingCode
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
        total_amount: donationAmount || 0,
        final_amount: donationAmount || 0,
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

    // Create payment item records
    const paymentItems = [{
      payment_id: paymentRecord.id,
      item_type: 'membership',
      item_id: membershipId,
      amount: 0,
    }]

    // Add donation item if applicable
    if (paymentOption === 'donation' && donationAmount && donationAmount > 0) {
      paymentItems.push({
        payment_id: paymentRecord.id,
        item_type: 'donation',
        item_id: membershipId,
        amount: donationAmount,
      })
    }

    const { error: paymentItemError } = await supabase
      .from('payment_items')
      .insert(paymentItems)

    if (paymentItemError) {
      logger.logPaymentProcessing(
        'payment-items-error',
        'Error creating payment item records for free membership',
        { 
          userId: user.id, 
          paymentId: paymentRecord.id,
          error: paymentItemError.message
        },
        'error'
      )
      capturePaymentError(paymentItemError, paymentContext, 'warning')
    }


    // Create the membership record directly (similar to webhook processing)
    const startDate = new Date()
    const endDate = new Date(startDate)
    endDate.setMonth(endDate.getMonth() + durationMonths)

    const { error: membershipError } = await supabase
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

    if (membershipError) {
      capturePaymentError(membershipError, paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 })
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
    const { membershipId, durationMonths, amount, paymentOption, assistanceAmount, donationAmount } = body
    
    // Set payment context for Sentry
    const paymentContext = {
      userId: user.id,
      userEmail: user.email,
      membershipId: membershipId,
      amountCents: amount,
      endpoint: '/api/create-payment-intent',
      operation: 'payment_intent_creation'
    }
    setPaymentContext(paymentContext)

    // Validate required fields (amount can be 0 for free memberships)
    if (!membershipId || !durationMonths || amount === undefined || amount === null) {
      const error = new Error('Missing required fields: membershipId, durationMonths, amount')
      capturePaymentError(error, paymentContext, 'warning')
      
      return NextResponse.json(
        { error: 'Missing required fields: membershipId, durationMonths, amount' },
        { status: 400 }
      )
    }

    // Handle free membership (amount = 0) - no Stripe payment needed
    if (amount === 0) {
      return await handleFreeMembership({
        supabase,
        user,
        userProfile: null, // Will fetch in function
        membership: null, // Will fetch in function
        membershipId,
        durationMonths,
        paymentOption,
        assistanceAmount,
        donationAmount,
        paymentContext,
        startTime
      })
    }

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
      if (paymentOption === 'assistance') {
        return assistanceAmount || 0
      }
      // For donations and standard, use the base membership price calculation
      const basePrice = durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths
      return basePrice
    }

    const membershipAmount = getMembershipAmount()
    
    // Calculate full membership price for assistance scenarios
    const fullMembershipPrice = durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths
    const discountAmount = paymentOption === 'assistance' ? (fullMembershipPrice - (assistanceAmount || 0)) : 0

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
        amount: amount
      },
      'info'
    )

    const stagingData = {
      user_id: user.id,
      total_amount: paymentOption === 'assistance' ? fullMembershipPrice : amount,
      discount_amount: discountAmount,
      final_amount: amount,
      payment_items: [
        {
          item_type: 'membership' as const,
          item_id: membershipId,
          amount: paymentOption === 'assistance' ? fullMembershipPrice : membershipAmount,
          description: `Membership: ${membership.name} - ${durationMonths} months`,
          accounting_code: membership.accounting_code
        }
      ],
      discount_codes_used: paymentOption === 'assistance' && discountAmount > 0 ? [
        {
          code: 'FINANCIAL_ASSISTANCE',
          amount_saved: discountAmount,
          category_name: 'Financial Assistance',
          accounting_code: discountAccountingCode
        }
      ] : [],
      stripe_payment_intent_id: null // Will be updated after Stripe intent creation
    }

    // Add donation item if applicable
    if (paymentOption === 'donation' && donationAmount && donationAmount > 0) {
      stagingData.payment_items.push({
        item_type: 'donation' as const,
        item_id: membershipId,
        amount: donationAmount,
        description: `Donation - ${membership.name}`,
        accounting_code: donationAccountingCode
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
          amount: amount
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
        amount: amount
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
      amount: amount, // Amount in cents
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

    const totalAmount = amount // This is the final amount sent from frontend

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
      // Create payment item records
      const paymentItems = []

      // Always add membership item
      paymentItems.push({
        payment_id: paymentRecord.id,
        item_type: 'membership',
        item_id: membershipId,
        amount: membershipAmount,
      })

      // Add donation item if applicable
      if (paymentOption === 'donation' && donationAmount && donationAmount > 0) {
        paymentItems.push({
          payment_id: paymentRecord.id,
          item_type: 'donation',
          item_id: membershipId, // Link to membership for context
          amount: donationAmount,
        })
      }

      const { error: paymentItemError } = await supabase
        .from('payment_items')
        .insert(paymentItems)

      if (paymentItemError) {
        logger.logPaymentProcessing(
          'payment-items-error',
          'Error creating payment item records for paid membership',
          { 
            userId: user.id, 
            paymentId: paymentRecord.id,
            paymentIntentId: paymentIntent.id,
            error: paymentItemError.message
          },
          'error'
        )
        capturePaymentError(paymentItemError, paymentContext, 'warning')
      }
    }

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
      endpoint: '/api/create-payment-intent',
      operation: 'payment_intent_creation'
    }, 'error')
    
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    )
  }
}