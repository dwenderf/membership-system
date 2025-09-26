import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager, StagingPaymentData } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'
import { getRegistrationAccountingCodes } from '@/lib/accounting-codes'
import { getBaseUrl } from '@/lib/url-utils'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess, PaymentContext } from '@/lib/sentry-helpers'
import { paymentProcessor } from '@/lib/payment-completion-processor'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

interface PayWithSavedMethodRequest {
  // For registrations
  registrationId?: string
  categoryId?: string
  presaleCode?: string
  discountCode?: string
  existingPaymentIntentId?: string // Payment intent to cancel
  
  // For memberships  
  membershipId?: string
  durationMonths?: number
  paymentOption?: 'assistance' | 'donation' | 'standard'
  assistanceAmount?: number
  donationAmount?: number
  
  // Common
  amount: number
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: PayWithSavedMethodRequest = await request.json()
    const { amount, registrationId, categoryId, membershipId, durationMonths, discountCode, existingPaymentIntentId } = body
    
    // Set payment context for Sentry
    const paymentContext: PaymentContext = {
      userId: user.id,
      userEmail: user.email,
      registrationId: registrationId,
      categoryId: categoryId,
      membershipId: membershipId,
      amountCents: amount,
      discountCode: discountCode,
      paymentIntentId: undefined,
      endpoint: '/api/pay-with-saved-method',
      operation: 'saved_method_payment'
    }
    setPaymentContext(paymentContext)

    // Validate required fields
    if (!amount || amount <= 0) {
      const error = new Error('Invalid amount')
      capturePaymentError(error, paymentContext, 'warning')
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Determine payment type
    const isRegistration = !!(registrationId && categoryId)
    const isMembership = !!(membershipId && durationMonths)
    
    if (!isRegistration && !isMembership) {
      const error = new Error('Must specify either registration or membership details')
      capturePaymentError(error, paymentContext, 'warning')
      return NextResponse.json({ error: 'Invalid payment type' }, { status: 400 })
    }

    // Get user's payment method and customer info
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('stripe_payment_method_id, setup_intent_status, email, first_name, last_name, stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (userError || !userProfile) {
      capturePaymentError(userError || new Error('User profile not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (!userProfile.stripe_payment_method_id || userProfile.setup_intent_status !== 'succeeded') {
      const error = new Error('No valid payment method found')
      capturePaymentError(error, paymentContext, 'warning')
      return NextResponse.json({ error: 'No valid payment method found' }, { status: 400 })
    }

    if (!userProfile.stripe_customer_id) {
      const error = new Error('No Stripe customer ID found')
      capturePaymentError(error, paymentContext, 'error')
      return NextResponse.json({ error: 'Payment setup incomplete' }, { status: 400 })
    }

    // Cancel existing payment intent if provided (to free up reservation)
    if (existingPaymentIntentId) {
      try {
        await stripe.paymentIntents.cancel(existingPaymentIntentId)
        logger.logPaymentProcessing(
          'saved-method-cancelled-existing-intent',
          'Cancelled existing payment intent when using saved method',
          { 
            userId: user.id, 
            cancelledPaymentIntentId: existingPaymentIntentId,
            registrationId,
            membershipId
          },
          'info'
        )
      } catch (cancelError) {
        logger.logPaymentProcessing(
          'saved-method-cancel-failed',
          'Failed to cancel existing payment intent',
          { 
            userId: user.id, 
            existingPaymentIntentId,
            error: cancelError instanceof Error ? cancelError.message : String(cancelError)
          },
          'warn'
        )
        // Continue anyway - the saved method payment should still work
      }
    }

    let finalAmount = amount
    let discountAmount = 0
    let validatedDiscountCode = null

    // Handle discount validation for registrations
    if (isRegistration && discountCode) {
      try {
        const discountResponse = await fetch(`${getBaseUrl()}/api/validate-discount-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('cookie') || '',
          },
          body: JSON.stringify({
            code: discountCode,
            registrationId: registrationId,
            amount: amount
          })
        })

        if (discountResponse.ok) {
          const discountResult = await discountResponse.json()
          
          if (discountResult.isValid) {
            validatedDiscountCode = discountResult.discountCode
            discountAmount = Math.round(discountResult.discountAmount)
            finalAmount = Math.max(0, amount - discountAmount)
          }
        }
      } catch (discountError) {
        logger.logPaymentProcessing(
          'saved-method-discount-validation-error',
          'Error validating discount code for saved method payment',
          { 
            userId: user.id, 
            registrationId,
            discountCode,
            error: discountError instanceof Error ? discountError.message : String(discountError)
          },
          'warn'
        )
        // Continue without discount
      }
    }

    // Get item details for description and staging
    let itemName = ''
    let itemDescription = ''
    let accountingCode = ''
    
    if (isRegistration) {
      const { data: registration, error: registrationError } = await supabase
        .from('registrations')
        .select(`
          *,
          season:seasons(*),
          registration_categories(
            *,
            category:categories(name)
          )
        `)
        .eq('id', registrationId)
        .single()

      if (registrationError || !registration) {
        capturePaymentError(registrationError || new Error('Registration not found'), paymentContext, 'error')
        return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
      }

      const selectedCategory = registration.registration_categories?.find(
        (cat: { id: string }) => cat.id === categoryId
      )

      if (!selectedCategory) {
        capturePaymentError(new Error('Category not found'), paymentContext, 'error')
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }

      const categoryName = selectedCategory.category?.name || selectedCategory.custom_name || 'Registration'
      itemName = `${registration.name} - ${categoryName}`
      itemDescription = `Registration: ${itemName}`
      
      // Get accounting codes
      const accountingCodes = await getRegistrationAccountingCodes(
        registrationId,
        categoryId,
        discountCode
      )
      accountingCode = accountingCodes.registration || ''

    } else if (isMembership) {
      const { data: membership, error: membershipError } = await supabase
        .from('memberships')
        .select('*')
        .eq('id', membershipId)
        .single()

      if (membershipError || !membership) {
        capturePaymentError(membershipError || new Error('Membership not found'), paymentContext, 'error')
        return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
      }

      itemName = `${membership.name} (${durationMonths} months)`
      itemDescription = `Membership: ${itemName}`
      accountingCode = membership.accounting_code || ''
    }

    // Create staging record for Xero
    const paymentItems: Array<{
      item_type: 'registration' | 'membership' | 'discount'
      item_id: string | null
      item_amount: any
      description: string
      accounting_code?: string
      discount_code_id?: string
    }> = []

    // Add main item
    paymentItems.push({
      item_type: isRegistration ? 'registration' : 'membership',
      item_id: isRegistration ? registrationId! : membershipId!,
      item_amount: centsToCents(amount),
      description: itemDescription,
      accounting_code: accountingCode || undefined
    })

    // Add discount item if applicable
    if (validatedDiscountCode && discountAmount > 0) {
      const accountingCodes = isRegistration 
        ? await getRegistrationAccountingCodes(registrationId!, categoryId!, discountCode)
        : { discount: validatedDiscountCode.category?.accounting_code }

      paymentItems.push({
        item_type: 'discount',
        item_id: null,
        item_amount: centsToCents(-discountAmount),
        description: `Discount: ${discountCode} (${validatedDiscountCode.category?.name || 'Discount'})`,
        accounting_code: accountingCodes.discount || undefined,
        discount_code_id: validatedDiscountCode.id
      })
    }

    const stagingData: StagingPaymentData = {
      user_id: user.id,
      total_amount: centsToCents(amount),
      discount_amount: centsToCents(discountAmount),
      final_amount: centsToCents(finalAmount),
      payment_items: paymentItems
    }

    const stagingRecord = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: finalAmount === 0 })
    if (!stagingRecord) {
      logger.logPaymentProcessing(
        'saved-method-staging-failed',
        'Failed to create Xero staging record for saved method payment',
        { userId: user.id, amount: finalAmount },
        'error'
      )
      capturePaymentError(new Error('Failed to stage records'), paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to process payment - staging failed' }, { status: 500 })
    }

    // Handle free payment (after discount)
    if (finalAmount === 0) {
      return await handleFreePayment(
        user.id,
        stagingRecord,
        paymentContext,
        startTime,
        isRegistration,
        registrationId,
        categoryId,
        membershipId,
        durationMonths,
        body,
        validatedDiscountCode?.id
      )
    }

    // Create Payment Intent for the charge
    const paymentIntent = await stripe.paymentIntents.create({
      amount: centsToCents(finalAmount),
      currency: 'usd',
      payment_method: userProfile.stripe_payment_method_id,
      customer: userProfile.stripe_customer_id,
      confirm: true, // Immediately attempt to charge
      off_session: true, // This is an off-session payment
      receipt_email: userProfile.email,
      metadata: {
        userId: user.id,
        userName: `${userProfile.first_name} ${userProfile.last_name}`,
        purpose: isRegistration ? 'registration_saved_method' : 'membership_saved_method',
        ...(isRegistration && { registrationId: registrationId!, categoryId: categoryId! }),
        ...(isMembership && { membershipId: membershipId!, durationMonths: durationMonths!.toString() }),
        ...(discountCode && { discountCode }),
        originalAmount: amount.toString(),
        discountAmount: discountAmount.toString(),
        finalAmount: finalAmount.toString()
      },
      description: `Saved Method Payment: ${itemName}`
    })

    // Update payment context with payment intent ID
    paymentContext.paymentIntentId = paymentIntent.id

    if (paymentIntent.status !== 'succeeded') {
      const error = new Error(`Payment failed with status: ${paymentIntent.status}`)
      capturePaymentError(error, paymentContext, 'error')
      return NextResponse.json({ 
        error: 'Payment failed. Please try using a different payment method.' 
      }, { status: 400 })
    }

    // Update staging record with payment intent ID
    const currentMetadata = stagingRecord.staging_metadata || {}
    const updatedMetadata = {
      ...currentMetadata,
      stripe_payment_intent_id: paymentIntent.id
    }

    await adminSupabase
      .from('xero_invoices')
      .update({ staging_metadata: updatedMetadata })
      .eq('id', stagingRecord.id)

    // Create payment record
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: centsToCents(amount),
        discount_amount: centsToCents(discountAmount),
        final_amount: centsToCents(finalAmount),
        stripe_payment_intent_id: paymentIntent.id,
        status: 'completed',
        payment_method: 'stripe',
        completed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (paymentError) {
      capturePaymentError(paymentError, paymentContext, 'warning')
      return NextResponse.json({ error: 'Payment succeeded but failed to record' }, { status: 500 })
    }

    // Link payment to staging records
    await adminSupabase
      .from('xero_invoices')
      .update({ payment_id: paymentRecord.id })
      .eq('id', stagingRecord.id)

    // Process registration or membership creation and get the actual record IDs
    let actualRecordId: string
    if (isRegistration) {
      const registrationRecord = await processRegistrationCompletion(
        user.id,
        registrationId!,
        categoryId!,
        paymentRecord.id,
        body.presaleCode,
        validatedDiscountCode?.id
      )
      actualRecordId = registrationRecord.id
    } else if (isMembership) {
      const membershipRecord = await processMembershipCompletion(
        user.id,
        membershipId!,
        durationMonths!,
        paymentRecord.id,
        body
      )
      actualRecordId = membershipRecord.id
    } else {
      actualRecordId = paymentRecord.id // Fallback to payment ID
    }

    // Record discount usage if applicable
    if (validatedDiscountCode && discountAmount > 0) {
      await recordDiscountUsage(
        user.id,
        validatedDiscountCode.id,
        isRegistration ? registrationId! : null,
        discountAmount
      )
    }

    // Trigger post-payment processing with the correct record ID
    try {
      const recordType = isRegistration ? 'user_registrations' : 'user_memberships'
      const triggerSource = finalAmount === 0 
        ? (isRegistration ? 'free_registration' : 'free_membership')
        : (isRegistration ? 'user_registrations' : 'user_memberships')
      
      await paymentProcessor.processPaymentCompletion({
        event_type: recordType,
        record_id: actualRecordId, // Now using the actual registration/membership record ID
        user_id: user.id,
        payment_id: paymentRecord.id,
        amount: finalAmount,
        trigger_source: triggerSource,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.logPaymentProcessing(
        'saved-method-post-processing-error',
        'Failed to trigger post-payment processing',
        { 
          userId: user.id, 
          paymentId: paymentRecord.id,
          actualRecordId,
          error: error instanceof Error ? error.message : String(error)
        },
        'warn'
      )
    }

    logger.logPaymentProcessing(
      'saved-method-payment-success',
      'Successfully processed saved method payment',
      {
        userId: user.id,
        paymentIntentId: paymentIntent.id,
        amountCharged: finalAmount,
        discountAmount,
        type: isRegistration ? 'registration' : 'membership'
      },
      'info'
    )

    capturePaymentSuccess('saved_method_payment', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      success: true,
      paymentId: paymentRecord.id,
      amountCharged: finalAmount,
      message: isRegistration ? 'Registration completed successfully!' : 'Membership activated successfully!'
    })
    
  } catch (error) {
    logger.logPaymentProcessing(
      'saved-method-payment-error',
      'Error processing saved method payment',
      { 
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    
    capturePaymentError(error, {
      endpoint: '/api/pay-with-saved-method',
      operation: 'saved_method_payment'
    }, 'error')
    
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}

// Helper functions
async function handleFreePayment(
  userId: string,
  stagingRecord: any,
  paymentContext: PaymentContext,
  startTime: number,
  isRegistration: boolean,
  registrationId?: string,
  categoryId?: string,
  membershipId?: string,
  durationMonths?: number,
  body?: any,
  discountCodeId?: string
) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Create payment record with $0 amount
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: userId,
        total_amount: 0,
        final_amount: 0,
        stripe_payment_intent_id: null,
        status: 'completed',
        payment_method: 'free',
        completed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (paymentError) {
      throw new Error(`Failed to create payment record: ${paymentError.message}`)
    }

    // Link payment to staging records
    await adminSupabase
      .from('xero_invoices')
      .update({ payment_id: paymentRecord.id })
      .eq('id', stagingRecord.id)

    // Process registration or membership creation and get the actual record IDs
    let actualRecordId: string
    if (isRegistration) {
      const registrationRecord = await processRegistrationCompletion(
        userId,
        registrationId!,
        categoryId!,
        paymentRecord.id,
        body?.presaleCode,
        discountCodeId
      )
      actualRecordId = registrationRecord.id
    } else if (membershipId && durationMonths) {
      const membershipRecord = await processMembershipCompletion(
        userId,
        membershipId,
        durationMonths,
        paymentRecord.id,
        body
      )
      actualRecordId = membershipRecord.id
    } else {
      actualRecordId = paymentRecord.id // Fallback to payment ID
    }

    // Trigger post-payment processing for free payments too
    try {
      const recordType = isRegistration ? 'user_registrations' : 'user_memberships'
      const triggerSource = isRegistration ? 'free_registration' : 'free_membership'
      
      await paymentProcessor.processPaymentCompletion({
        event_type: recordType,
        record_id: actualRecordId,
        user_id: userId,
        payment_id: paymentRecord.id,
        amount: 0,
        trigger_source: triggerSource,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.logPaymentProcessing(
        'saved-method-free-post-processing-error',
        'Failed to trigger post-payment processing for free payment',
        { 
          userId, 
          paymentId: paymentRecord.id,
          actualRecordId,
          error: error instanceof Error ? error.message : String(error)
        },
        'warn'
      )
    }

    capturePaymentSuccess('free_saved_method_payment', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      success: true,
      paymentId: paymentRecord.id,
      amountCharged: 0,
      isFree: true,
      message: isRegistration ? 'Free registration completed successfully!' : 'Free membership activated successfully!'
    })

  } catch (error) {
    capturePaymentError(error, paymentContext, 'error')
    return NextResponse.json({ error: 'Failed to process free payment' }, { status: 500 })
  }
}

async function processRegistrationCompletion(
  userId: string,
  registrationId: string,
  categoryId: string,
  paymentId: string,
  presaleCode?: string,
  discountCodeId?: string
) {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()

  // Get user's active membership for eligibility
  const { data: activeMembership } = await supabase
    .from('user_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('payment_status', 'paid')
    .gte('valid_until', new Date().toISOString().split('T')[0])
    .limit(1)
    .single()

  // Get registration details for pricing
  const { data: registration } = await supabase
    .from('registrations')
    .select(`
      registration_categories(price)
    `)
    .eq('id', registrationId)
    .single()

  const selectedCategory = registration?.registration_categories?.find(
    (cat: any) => cat.id === categoryId
  )

  // Create user registration record
  const { data: registrationRecord, error: registrationError } = await adminSupabase
    .from('user_registrations')
    .insert({
      user_id: userId,
      registration_id: registrationId,
      registration_category_id: categoryId,
      user_membership_id: activeMembership?.id || null,
      payment_status: 'paid',
      payment_id: paymentId,
      registration_fee: selectedCategory?.price || 0,
      amount_paid: 0, // Will be updated based on final payment amount
      registered_at: new Date().toISOString(),
      presale_code_used: presaleCode || null,
    })
    .select('id')
    .single()

  if (registrationError) {
    throw new Error(`Failed to create registration record: ${registrationError.message}`)
  }

  return registrationRecord
}

async function processMembershipCompletion(
  userId: string,
  membershipId: string,
  durationMonths: number,
  paymentId: string,
  body: any
) {
  const supabase = await createClient()

  // Calculate membership dates (you'll need to implement this logic)
  const startDate = new Date()
  const endDate = new Date()
  endDate.setMonth(endDate.getMonth() + durationMonths)

  // Create user membership record
  const { data: membershipRecord, error: membershipError } = await supabase
    .from('user_memberships')
    .insert({
      user_id: userId,
      membership_id: membershipId,
      payment_id: paymentId,
      payment_status: 'paid',
      valid_from: startDate.toISOString().split('T')[0],
      valid_until: endDate.toISOString().split('T')[0],
      months_purchased: durationMonths,
      purchased_at: new Date().toISOString()
    })
    .select('id')
    .single()

  if (membershipError) {
    throw new Error(`Failed to create membership record: ${membershipError.message}`)
  }

  return membershipRecord
}

async function recordDiscountUsage(
  userId: string,
  discountCodeId: string,
  registrationId: string | null,
  amountSaved: number
) {
  try {
    const supabase = await createClient()

    // Check if usage already exists to prevent duplicates
    const { data: existingUsage } = await supabase
      .from('discount_usage')
      .select('id')
      .eq('user_id', userId)
      .eq('discount_code_id', discountCodeId)
      .eq('registration_id', registrationId)
      .single()

    if (!existingUsage) {
      const { error: insertError } = await supabase
        .from('discount_usage')
        .insert({
          user_id: userId,
          discount_code_id: discountCodeId,
          amount_saved: amountSaved,
          registration_id: registrationId
        })

      if (insertError) {
        logger.logPaymentProcessing(
          'discount-usage-recording-failed',
          'Failed to record discount usage',
          {
            userId,
            discountCodeId,
            registrationId,
            amountSaved,
            error: insertError.message
          },
          'warn'
        )
      }
    }
  } catch (error) {
    logger.logPaymentProcessing(
      'discount-usage-recording-error',
      'Error recording discount usage',
      {
        userId,
        discountCodeId,
        registrationId,
        amountSaved,
        error: error instanceof Error ? error.message : String(error)
      },
      'warn'
    )
  }
}