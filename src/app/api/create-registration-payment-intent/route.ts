import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSingleCategoryRegistrationCount } from '@/lib/registration-counts'
import { getBaseUrl } from '@/lib/url-utils'
import { createXeroInvoiceBeforePayment, PrePaymentInvoiceData } from '@/lib/xero/invoices'
import { xeroStagingManager } from '@/lib/xero/staging'
import { logger } from '@/lib/logging/logger'
import { getRegistrationAccountingCodes } from '@/lib/accounting-codes'
import { paymentProcessor } from '@/lib/payment-completion-processor'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess, PaymentContext } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

// Handle free registration purchases (amount = 0)
async function handleFreeRegistration({
  supabase,
  user,
  registrationId,
  categoryId,
  presaleCode,
  discountCode,
  paymentContext,
  startTime
}: {
  supabase: any
  user: any
  registrationId: string
  categoryId: string
  presaleCode?: string
  discountCode?: string
  paymentContext: any
  startTime: number
}) {
  try {
    const adminSupabase = createAdminClient()

    // Get registration details for validation
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

    // Find the selected category
    const selectedCategory = registration.registration_categories.find((cat: any) => cat.id === categoryId)
    if (!selectedCategory) {
      const error = new Error('Category not found')
      capturePaymentError(error, paymentContext, 'error')
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Get user's active membership for eligibility (if any)
    const { data: activeMembership } = await supabase
      .from('user_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('payment_status', 'paid')
      .gte('valid_until', new Date().toISOString().split('T')[0])
      .limit(1)
      .single()

    // Create user registration record (free registration - mark as paid immediately)
    const { data: reservationData, error: reservationError } = await adminSupabase
      .from('user_registrations')
      .insert({
        user_id: user.id,
        registration_id: registrationId,
        registration_category_id: categoryId,
        user_membership_id: activeMembership?.id || null,
        payment_status: 'paid',
        registration_fee: selectedCategory.price || 0, // Original price before discount
        amount_paid: 0, // Amount actually paid (0 for free registration)
        registered_at: new Date().toISOString(),
        presale_code_used: presaleCode || null,
      })
      .select('id')
      .single()

    if (reservationError) {
      if (reservationError.code === '23505') { // Duplicate key error
        return NextResponse.json({ error: 'You are already registered for this category' }, { status: 409 })
      }
      capturePaymentError(reservationError, paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to reserve spot' }, { status: 500 })
    }

    // Create staging record immediately with invoice line items
    try {
      logger.logPaymentProcessing(
        'staging-creation-start',
        'Creating Xero staging record for free registration',
        { 
          userId: user.id, 
          registrationId,
          categoryId
        },
        'info'
      )
      
      // Get registration and category details for invoice line items
      const registrationCategory = registration.registration_categories.find((rc: any) => rc.id === categoryId)
      
      if (registrationCategory) {
        // Build invoice data with line items
        const fullPrice = registrationCategory.price || 0
        
        // Get accounting codes using the centralized helper
        const accountingCodes = await getRegistrationAccountingCodes(
          registrationId,
          categoryId,
          discountCode
        )

        const paymentItems = [{
          item_type: 'registration' as const,
          item_id: registrationId,
          amount: fullPrice, // Full registration price
          description: `Registration: ${registration.name} - ${registrationCategory.category?.name || registrationCategory.custom_name}`,
          accounting_code: accountingCodes.registration || undefined
        }]

        // Add discount line items if applicable
        const discountCodesUsed = []
        if (discountCode && fullPrice > 0) {
          discountCodesUsed.push({
            code: discountCode,
            amount_saved: fullPrice, // Full price was discounted
            category_name: 'Registration Discount',
            accounting_code: accountingCodes.discount || undefined
          })
        }

        // Create staging record
        const stagingResult = await xeroStagingManager.createImmediateStaging({
          user_id: user.id,
          total_amount: fullPrice,
          discount_amount: fullPrice, // Full discount for free registration
          final_amount: 0,
          payment_items: paymentItems,
          discount_codes_used: discountCodesUsed
        }, { isFree: true })
        
        if (!stagingResult) {
          // Cleanup: Mark user_registrations as failed so it doesn't block future attempts
          await adminSupabase
            .from('user_registrations')
            .update({ payment_status: 'failed' })
            .eq('id', reservationData.id)

          logger.logPaymentProcessing(
            'staging-creation-failed',
            'Failed to create Xero staging record for free registration',
            { 
              userId: user.id, 
              registrationId,
              categoryId
            },
            'error'
          )
          capturePaymentError(new Error('Failed to stage Xero records'), paymentContext, 'error')
          return NextResponse.json({ error: 'Failed to process registration - Xero staging failed' }, { status: 500 })
        }

        logger.logPaymentProcessing(
          'staging-creation-success',
          'Successfully created Xero staging record for free registration',
          { 
            userId: user.id, 
            registrationId,
            categoryId
          },
          'info'
        )
      }
    } catch (error) {
      // Cleanup: Mark user_registrations as failed so it doesn't block future attempts
      await adminSupabase
        .from('user_registrations')
        .update({ payment_status: 'failed' })
        .eq('id', reservationData.id)

      logger.logPaymentProcessing(
        'staging-creation-error',
        'Error creating Xero staging record for free registration',
        { 
          userId: user.id, 
          registrationId,
          categoryId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      capturePaymentError(error, paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to process registration - Xero staging error' }, { status: 500 })
    }

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
        completed_at: now, // Critical: needed for payment completion triggers
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
        registrationId
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


    // Registration already created with correct status (paid), no update needed

    // Record discount usage if applicable
    if (discountCode) {
      // Note: In free registration case, the full amount was discounted
      // We should still track this usage for limit enforcement
      const { data: discountValidation } = await fetch(`${getBaseUrl()}/api/validate-discount-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: discountCode,
          registrationId: registrationId,
          amount: selectedCategory.price || 0 // Use original price for tracking
        })
      }).then(res => res.json()).catch(() => ({ isValid: false }))

      if (discountValidation?.isValid && discountValidation.discountCode) {
        // Check if discount usage already exists to prevent duplicates
        const { data: existingUsage } = await supabase
          .from('discount_usage')
          .select('id')
          .eq('user_id', user.id)
          .eq('discount_code_id', discountValidation.discountCode.id)
          .eq('registration_id', registrationId)
          .single()

        if (!existingUsage) {
          await supabase
            .from('discount_usage')
            .insert({
              user_id: user.id,
              discount_code_id: discountValidation.discountCode.id,
              discount_category_id: discountValidation.discountCode.category.id,
              season_id: registration.season.id,
              amount_saved: selectedCategory.price || 0, // Full price was saved
              registration_id: registrationId,
            })
        }
      }
    }

    // Trigger payment completion processor for emails and post-processing
    try {
      await paymentProcessor.processPaymentCompletion({
        event_type: 'user_registrations',
        record_id: reservationData.id,
        user_id: user.id,
        payment_id: null, // No payment for free registration
        amount: 0,
        trigger_source: 'free_registration',
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      // Email staging failures are non-critical - don't fail the transaction
      logger.logPaymentProcessing(
        'free-registration-email-error',
        'Failed to stage confirmation email for free registration',
        { 
          userId: user.id, 
          registrationId,
          categoryId,
          registrationRecordId: reservationData.id,
          error: error instanceof Error ? error.message : String(error)
        },
        'warn'
      )
    }

    // Log successful operation
    capturePaymentSuccess('free_registration_creation', paymentContext, Date.now() - startTime)

    // Return success without client secret (no Stripe payment needed)
    return NextResponse.json({
      success: true,
      paymentIntentId: null,
      isFree: true,
      message: 'Free registration completed successfully - Xero invoice will be created via batch processing'
    })

  } catch (error) {
    logger.logPaymentProcessing(
      'free-registration-error',
      'Error handling free registration',
      { 
        userId: user.id, 
        registrationId,
        categoryId,
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
    const { registrationId, categoryId, amount, presaleCode, discountCode } = body
    
    // Set payment context for Sentry
    const paymentContext: PaymentContext = {
      userId: user.id,
      userEmail: user.email,
      registrationId: registrationId,
      categoryId: categoryId,
      amountCents: amount,
      discountCode: discountCode,
      paymentIntentId: undefined, // Will be set after Stripe payment intent creation
      endpoint: '/api/create-registration-payment-intent',
      operation: 'registration_payment_intent_creation'
    }
    setPaymentContext(paymentContext)

    // Validate required fields (amount can be 0 for free registrations)
    if (!registrationId || !categoryId || amount === undefined || amount === null) {
      const error = new Error('Missing required fields: registrationId, categoryId, amount')
      capturePaymentError(error, paymentContext, 'warning')
      
      return NextResponse.json(
        { error: 'Missing required fields: registrationId, categoryId, amount' },
        { status: 400 }
      )
    }

    // Handle free registration (amount = 0) - no Stripe payment needed
    if (amount === 0) {
      return await handleFreeRegistration({
        supabase,
        user,
        registrationId,
        categoryId,
        presaleCode,
        discountCode,
        paymentContext,
        startTime
      })
    }

    // Fetch registration details with category and season info first (needed for discount calculation)
    const { data: registration, error: registrationError } = await supabase
      .from('registrations')
      .select(`
        *,
        season:seasons(*),
        registration_categories(
          *,
          category:categories(name),
          membership:memberships(name)
        )
      `)
      .eq('id', registrationId)
      .single()

    if (registrationError || !registration) {
      capturePaymentError(registrationError || new Error('Registration not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Find the specific category
    const selectedCategory = registration.registration_categories?.find(
      (cat: { id: string }) => cat.id === categoryId
    )

    if (!selectedCategory) {
      capturePaymentError(new Error('Category not found'), paymentContext, 'error')
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Check if user already has a completed registration (exclude failed records for audit trail)
    const { data: existingRegistration } = await supabase
      .from('user_registrations')
      .select('id, payment_status')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .in('payment_status', ['paid', 'refunded'])
      .single()

    if (existingRegistration) {
      capturePaymentError(new Error('User already registered'), paymentContext, 'warning')
      return NextResponse.json({ 
        error: existingRegistration.payment_status === 'paid' 
          ? 'You are already registered for this event'
          : 'You have a refunded registration for this event. Please contact support for assistance.'
      }, { status: 400 })
    }

    // Check membership eligibility if required
    if (selectedCategory.required_membership_id) {
      const today = new Date().toISOString().split('T')[0]
      
      // Debug: Get all user memberships to see what we have
      const { data: allUserMemberships } = await supabase
        .from('user_memberships')
        .select('id, membership_id, valid_until, payment_status')
        .eq('user_id', user.id)
        .eq('membership_id', selectedCategory.required_membership_id)
      

      const { data: userMemberships } = await supabase
        .from('user_memberships')
        .select('id, valid_until')
        .eq('user_id', user.id)
        .eq('membership_id', selectedCategory.required_membership_id)
        .eq('payment_status', 'paid')
        .gte('valid_until', today)

      // Find the membership with the latest expiration date (same logic as frontend)
      const validMembership = userMemberships && userMemberships.length > 0 
        ? userMemberships.reduce((latest, current) => {
            return new Date(current.valid_until) > new Date(latest.valid_until) ? current : latest
          })
        : null

      if (!validMembership) {
        const membershipName = selectedCategory.membership?.name || 'Required membership'
        capturePaymentError(new Error('Membership required'), paymentContext, 'warning')
        return NextResponse.json({ 
          error: `${membershipName} membership required for this registration` 
        }, { status: 400 })
      }
    }

    // Handle discount validation and application
    let finalAmount = amount
    let discountAmount = 0
    let validatedDiscountCode = null

    if (discountCode) {
      // Validate discount code via API
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
            discountAmount = discountResult.discountAmount
            finalAmount = amount - discountAmount
            
            // Ensure final amount is not negative
            if (finalAmount < 0) {
              finalAmount = 0
            }
          } else {
            capturePaymentError(new Error('Invalid discount code'), paymentContext, 'warning')
            return NextResponse.json({ 
              error: discountResult.error || 'Invalid discount code' 
            }, { status: 400 })
          }
        } else {
          capturePaymentError(new Error('Discount validation failed'), paymentContext, 'warning')
          return NextResponse.json({ 
            error: 'Failed to validate discount code' 
          }, { status: 400 })
        }
      } catch (discountError) {
        logger.logPaymentProcessing(
          'discount-validation-error',
          'Error validating discount code',
          { 
            userId: user.id, 
            registrationId,
            discountCode,
            error: discountError instanceof Error ? discountError.message : String(discountError)
          },
          'error'
        )
        capturePaymentError(discountError, paymentContext, 'warning')
        return NextResponse.json({ 
          error: 'Failed to validate discount code' 
        }, { status: 500 })
      }
    }

    // Handle registration that becomes free after discount - route to free registration flow
    if (finalAmount === 0) {
      return await handleFreeRegistration({
        supabase,
        user,
        registrationId,
        categoryId,
        presaleCode,
        discountCode,
        paymentContext,
        startTime
      })
    }

    // STEP 1: Clean up any existing processing records for this user/registration first
    // This allows users to retry payments without being locked out for 5 minutes
    let reservationId: string | null = null // Declare here so it's accessible throughout
    
    try {
      // Use admin client to bypass RLS for cleanup operations
      const adminSupabase = createAdminClient()
      
      // First check what records exist
      const { data: existingRecords } = await adminSupabase
        .from('user_registrations')
        .select('id, payment_status, reservation_expires_at, stripe_payment_intent_id')
        .eq('user_id', user.id)
        .eq('registration_id', registrationId)
      
      // Separate records by status
      const awaitingPaymentRecords = existingRecords?.filter(r => r.payment_status === 'awaiting_payment') || []
      const processingRecords = existingRecords?.filter(r => r.payment_status === 'processing') || []
      const failedRecords = existingRecords?.filter(r => r.payment_status === 'failed') || []
      
      // Handle 'processing' records - check Stripe status before blocking
      if (processingRecords.length > 0) {
        const processingRecord = processingRecords[0]
        
        // If there's a Stripe payment intent ID, check its status
        if (processingRecord.stripe_payment_intent_id) {
          try {
            logger.logPaymentProcessing(
              'stripe-status-check',
              'Checking Stripe status for payment intent',
              { 
                userId: user.id, 
                registrationId,
                paymentIntentId: processingRecord.stripe_payment_intent_id
              },
              'info'
            )
            const paymentIntent = await stripe.paymentIntents.retrieve(processingRecord.stripe_payment_intent_id)
            
            if (paymentIntent.status === 'succeeded') {
              // Payment succeeded but our DB wasn't updated - fix it
              logger.logPaymentProcessing(
                'payment-succeeded-db-update',
                'Payment succeeded, updating DB to paid status',
                { 
                  userId: user.id, 
                  registrationId,
                  paymentIntentId: processingRecord.stripe_payment_intent_id
                },
                'info'
              )
              await fetch(`${getBaseUrl()}/api/update-registration-status`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': request.headers.get('cookie') || '',
                },
                body: JSON.stringify({
                  registrationId: registrationId,
                  categoryId: selectedCategory.id,
                  status: 'paid'
                }),
              })
              
              return NextResponse.json({ 
                error: 'Your payment has already been completed successfully. Please check your registrations.'
              }, { status: 400 })
              
            } else if (['failed', 'canceled', 'requires_payment_method'].includes(paymentIntent.status)) {
              // Payment failed - clean up and allow retry
              logger.logPaymentProcessing(
                'payment-failed-cleanup',
                'Payment failed, cleaning up processing record',
                { 
                  userId: user.id, 
                  registrationId,
                  paymentIntentId: processingRecord.stripe_payment_intent_id,
                  status: paymentIntent.status
                },
                'info'
              )
              await adminSupabase
                .from('user_registrations')
                .delete()
                .eq('id', processingRecord.id)
                .eq('payment_status', 'processing')
              
              logger.logPaymentProcessing(
                'payment-retry-allowed',
                'Payment failed in Stripe, allowing user to retry',
                { 
                  userId: user.id, 
                  registrationId,
                  status: paymentIntent.status
                },
                'info'
              )
              // Continue with new payment attempt
              
            } else {
              // Payment still processing in Stripe - block retry
              capturePaymentError(new Error('Payment currently processing in Stripe'), paymentContext, 'warning')
              return NextResponse.json({ 
                error: `Your payment is currently being processed by Stripe. Please wait for it to complete before trying again.`
              }, { status: 409 })
            }
            
          } catch (stripeError) {
            logger.logPaymentProcessing(
              'stripe-status-check-error',
              'Error checking Stripe payment intent status',
              { 
                userId: user.id, 
                registrationId,
                paymentIntentId: processingRecord.stripe_payment_intent_id,
                error: stripeError instanceof Error ? stripeError.message : String(stripeError)
              },
              'error'
            )
            // If we can't check Stripe, be conservative and block
            capturePaymentError(new Error('Unable to verify payment status'), paymentContext, 'warning')
            return NextResponse.json({ 
              error: `Unable to verify your payment status. Please wait a moment and try again.`
            }, { status: 409 })
          }
        } else {
          // Processing record without Stripe ID - likely corrupted, clean it up
          logger.logPaymentProcessing(
            'cleanup-orphaned-record',
            'Cleaning up processing record without Stripe payment intent ID',
            { 
              userId: user.id, 
              registrationId,
              recordId: processingRecord.id
            },
            'info'
          )
          await adminSupabase
            .from('user_registrations')
            .delete()
            .eq('id', processingRecord.id)
            .eq('payment_status', 'processing')
        }
      }
      
      // Handle 'awaiting_payment' records - update existing record with fresh timer
      if (awaitingPaymentRecords.length > 0) {
        const existingRecord = awaitingPaymentRecords[0]
        logger.logPaymentProcessing(
          'update-awaiting-payment',
          'Updating existing awaiting_payment record with fresh timer',
          { 
            userId: user.id, 
            registrationId,
            recordId: existingRecord.id
          },
          'info'
        )
        
        const { data: updatedRecord, error: updateError } = await adminSupabase
          .from('user_registrations')
          .update({
            reservation_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // Fresh 5-minute timer
            stripe_payment_intent_id: null, // Clear any old payment intent
            registered_at: null // Clear registration timestamp
          })
          .eq('id', existingRecord.id)
          .select()
          .single()
        
        if (updateError) {
          logger.logPaymentProcessing(
            'update-awaiting-payment-error',
            'Error updating awaiting_payment record',
            { 
              userId: user.id, 
              registrationId,
              recordId: existingRecord.id,
              error: updateError.message
            },
            'error'
          )
          // Fall through to create new record
        } else {
          logger.logPaymentProcessing(
            'update-awaiting-payment-success',
            'Updated awaiting_payment record with fresh timer',
            { 
              userId: user.id, 
              registrationId,
              recordId: existingRecord.id
            },
            'info'
          )
          // Skip creating new record, continue with payment intent creation for existing record
          reservationId = existingRecord.id
        }
      }
      
      // Handle 'failed' records - reuse the most recent failed record for retry
      if (failedRecords.length > 0) {
        const failedRecord = failedRecords[0] // Use most recent failed record
        logger.logPaymentProcessing(
          'retry-failed-record',
          'Found failed payment record - reusing for retry attempt',
          { 
            userId: user.id, 
            registrationId,
            recordId: failedRecord.id
          },
          'info'
        )
        
        const { data: updatedRecord, error: updateError } = await adminSupabase
          .from('user_registrations')
          .update({
            payment_status: 'awaiting_payment',
            reservation_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // Fresh 5-minute timer
            stripe_payment_intent_id: null, // Clear previous payment intent
            registered_at: null // Clear registration timestamp
          })
          .eq('id', failedRecord.id)
          .select()
          .single()
        
        if (updateError) {
          logger.logPaymentProcessing(
            'retry-failed-record-error',
            'Error updating failed record',
            { 
              userId: user.id, 
              registrationId,
              recordId: failedRecord.id,
              error: updateError.message
            },
            'error'
          )
          // Fall through to create new record
        } else {
          logger.logPaymentProcessing(
            'retry-failed-record-success',
            'Updated failed record for retry with fresh timer',
            { 
              userId: user.id, 
              registrationId,
              recordId: failedRecord.id
            },
            'info'
          )
          // Skip creating new record, continue with payment intent creation for existing record
          reservationId = failedRecord.id
        }
      }
    } catch (cleanupError) {
      logger.logPaymentProcessing(
        'cleanup-error',
        'Error cleaning up existing processing records',
        { 
          userId: user.id, 
          registrationId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        },
        'error'
      )
      // Continue anyway - the insert will handle duplicates
    }

    // STEP 2: Reserve spot immediately (race condition protection)
    
    if (selectedCategory.max_capacity) {
      
      // Get current count including active reservations
      const currentCount = await getSingleCategoryRegistrationCount(categoryId)
      
      if (currentCount >= selectedCategory.max_capacity) {
        capturePaymentError(new Error('Registration full'), paymentContext, 'warning')
        return NextResponse.json({ 
          error: 'This category is at capacity',
          shouldShowWaitlist: true 
        }, { status: 400 })
      }

      // Create new reservation only if we don't already have one from updating existing record
      if (!reservationId) {
        // Create processing reservation (5 minute expiration)
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes from now
        
        const { data: reservation, error: reservationError } = await supabase
          .from('user_registrations')
          .insert({
            user_id: user.id,
            registration_id: registrationId,
            registration_category_id: categoryId,
            payment_status: 'awaiting_payment',
            reservation_expires_at: expiresAt.toISOString(),
            registration_fee: amount,
            amount_paid: finalAmount,
            presale_code_used: presaleCode || null,
          })
          .select()
          .single()

        if (reservationError) {
        logger.logPaymentProcessing(
          'reservation-creation-error',
          'Reservation creation error',
          { 
            userId: user.id, 
            registrationId,
            categoryId,
            error: reservationError.message,
            code: reservationError.code
          },
          'error'
        )
        
        // Check if this is a duplicate registration error
        if (reservationError.code === '23505') { // Unique constraint violation
          // Check what type of existing registration exists
          const { data: existingReg } = await supabase
            .from('user_registrations')
            .select('payment_status')
            .eq('user_id', user.id)
            .eq('registration_id', registrationId)
            .single()
          
          logger.logPaymentProcessing(
            'existing-registration-found',
            'Existing registration found during reservation creation',
            { 
              userId: user.id, 
              registrationId,
              categoryId,
              existingPaymentStatus: existingReg?.payment_status
            },
            'info'
          )
          
          return NextResponse.json({ 
            error: existingReg?.payment_status === 'paid' 
              ? 'You are already registered for this event'
              : 'Registration conflict - please try again'
          }, { status: 400 })
        }
        
        // Could be a race condition - check capacity again
        const recheckedCount = await getSingleCategoryRegistrationCount(categoryId)
        if (recheckedCount >= selectedCategory.max_capacity) {
          return NextResponse.json({ 
            error: 'This category just became full',
            shouldShowWaitlist: true 
          }, { status: 400 })
        }
        
        capturePaymentError(reservationError, paymentContext, 'error')
        return NextResponse.json({ error: 'Failed to reserve spot' }, { status: 500 })
        } else {
          reservationId = reservation.id
        }
      } else {
        logger.logPaymentProcessing(
          'using-existing-reservation',
          'Using existing updated record as reservation',
          { 
            userId: user.id, 
            registrationId,
            categoryId,
            reservationId
          },
          'info'
        )
      }
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

    // Get category display name
    const categoryName = selectedCategory.category?.name || selectedCategory.custom_name || 'Registration'

    // Create description for payment intent
    const getDescription = () => {
      const baseName = `${registration.name} - ${categoryName} (${registration.season?.name})`
      
      if (discountAmount > 0) {
        return `${baseName} - Discount: $${(discountAmount / 100).toFixed(2)}`
      }
      
      return baseName
    }

    // Stage Xero records FIRST - fail fast if this fails
    logger.logPaymentProcessing(
      'staging-creation-start',
      'Creating Xero staging record for paid registration',
      { 
        userId: user.id, 
        registrationId,
        categoryId,
        amount: finalAmount
      },
      'info'
    )

    // Get accounting codes using the centralized helper
    const accountingCodes = await getRegistrationAccountingCodes(
      registrationId,
      categoryId,
      discountCode
    )

    const stagingData = {
      user_id: user.id,
      total_amount: amount, // Original amount before discount
      discount_amount: discountAmount, // Discount amount
      final_amount: finalAmount, // Final amount being charged
      payment_items: [
        {
          item_type: 'registration' as const,
          item_id: registrationId,
          amount: amount, // Use original amount, not final amount after discount
          description: `Registration: ${registration.name} - ${categoryName}`,
          accounting_code: accountingCodes.registration || undefined
        }
      ],
      discount_codes_used: validatedDiscountCode ? [{
        code: discountCode!,
        amount_saved: discountAmount,
        category_name: validatedDiscountCode.category?.name || 'Registration Discount',
        accounting_code: accountingCodes.discount || undefined
      }] : [],
      stripe_payment_intent_id: undefined // Will be updated after Stripe intent creation
    }

    const stagingSuccess = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: false })
    if (!stagingSuccess) {
      logger.logPaymentProcessing(
        'staging-creation-failed',
        'Failed to create Xero staging record for paid registration',
        { 
          userId: user.id, 
          registrationId,
          categoryId,
          amount: finalAmount
        },
        'error'
      )
      capturePaymentError(new Error('Failed to stage Xero records'), paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to process registration - Xero staging failed' }, { status: 500 })
    }

    logger.logPaymentProcessing(
      'staging-creation-success',
      'Successfully created Xero staging record for paid registration',
      { 
        userId: user.id, 
        registrationId,
        categoryId,
        amount: finalAmount
      },
      'info'
    )

    // Create payment intent with explicit Link support
    const paymentIntentParams = {
      amount: finalAmount, // Final amount after discount in cents
      currency: 'usd',
      receipt_email: userProfile.email,
      payment_method_types: ['card', 'link'],
      metadata: {
        userId: user.id,
        registrationId: registrationId,
        registrationName: registration.name,
        categoryId: categoryId,
        categoryName: categoryName,
        seasonName: registration.season?.name || '',
        userName: `${userProfile.first_name} ${userProfile.last_name}`,
        presaleCodeUsed: presaleCode || '',
        reservationId: reservationId || '',
        originalAmount: amount.toString(),
        discountAmount: discountAmount.toString(),
        discountCode: discountCode || '',
        discountCategoryId: validatedDiscountCode?.category?.id || '',
        discountCategoryName: validatedDiscountCode?.category?.name || '',
        accountingCode: validatedDiscountCode?.category?.accounting_code || '',
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
        registrationId
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

    // Create payment record in database
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: amount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        stripe_payment_intent_id: paymentIntent.id,
        status: 'pending',
        payment_method: 'stripe',
      })
      .select()
      .single()


    if (paymentError) {
      logger.logPaymentProcessing(
        'payment-record-error',
        'Error creating payment record for paid registration',
        { 
          userId: user.id, 
          registrationId,
          categoryId,
          paymentIntentId: paymentIntent.id,
          error: paymentError.message
        },
        'error'
      )
      // Log warning but don't fail the request since Stripe intent was created
      capturePaymentError(paymentError, paymentContext, 'warning')
    } else if (paymentRecord) {
      logger.logPaymentProcessing(
        'payment-record-success',
        'Created payment record for Stripe payment intent',
        { 
          userId: user.id, 
          registrationId,
          categoryId,
          paymentId: paymentRecord.id,
          paymentIntentId: paymentIntent.id
        },
        'info'
      )
      
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
      
          // Payment items are now tracked in xero_invoice_line_items via the staging system
    // No need to create separate payment_items records
    }



    // Log successful operation
    capturePaymentSuccess('registration_payment_intent_creation', paymentContext, Date.now() - startTime)

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      reservationExpiresAt: reservationId ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : undefined,
      originalAmount: amount,
      discountAmount: discountAmount,
      finalAmount: finalAmount,
      discountCode: validatedDiscountCode,
    })
    
  } catch (error) {
    logger.logPaymentProcessing(
      'registration-payment-intent-error',
      'Error creating registration payment intent',
      { 
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    
    // Capture error in Sentry
    capturePaymentError(error, {
      endpoint: '/api/create-registration-payment-intent',
      operation: 'registration_payment_intent_creation'
    }, 'error')
    
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    )
  }
}