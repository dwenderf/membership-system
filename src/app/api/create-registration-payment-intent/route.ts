import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSingleCategoryRegistrationCount } from '@/lib/registration-counts'
import { getBaseUrl } from '@/lib/url-utils'
import { createXeroInvoiceBeforePayment, PrePaymentInvoiceData } from '@/lib/xero-invoices'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
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

    // Create atomic spot reservation first (same as paid flow)
    const { data: reservationData, error: reservationError } = await adminSupabase
      .from('user_registrations')
      .insert({
        user_id: user.id,
        registration_id: registrationId,
        registration_category_id: categoryId,
        payment_status: 'awaiting_payment',
        reservation_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
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

    // Create Xero invoice for zero payment
    let invoiceNumber = null
    let xeroInvoiceId = null
    
    try {
      // Get registration and category details for invoice
      const registrationCategory = registration.registration_categories.find((rc: any) => rc.id === categoryId)
      
      if (!registrationCategory) {
        throw new Error('Registration category not found')
      }
      
      // Build invoice data for Xero - always show full registration price
      const fullPrice = registrationCategory.price || 0
      const paymentItems = [{
        item_type: 'registration' as const,
        item_id: registrationId,
        amount: fullPrice, // Full registration price
        description: `Registration: ${registration.name} - ${registrationCategory.category?.name || registrationCategory.custom_name}`,
        accounting_code: registrationCategory.accounting_code || registration.accounting_code
      }]

      // Add discount line items if applicable
      const discountItems = []
      if (discountCode && fullPrice > 0) {
        // For free registrations, the discount amount equals the full price
        discountItems.push({
          code: discountCode,
          amount_saved: fullPrice, // Full price was discounted
          category_name: 'Registration Discount',
          accounting_code: undefined // Will use donation_given_default from system codes
        })
      }

      const xeroInvoiceData: PrePaymentInvoiceData = {
        user_id: user.id,
        total_amount: fullPrice, // Original price
        discount_amount: fullPrice, // Full discount
        final_amount: 0, // $0 after discount
        payment_items: paymentItems,
        discount_codes_used: discountItems
      }

      const invoiceResult = await createXeroInvoiceBeforePayment(xeroInvoiceData, { 
        markAsAuthorised: true // Mark as AUTHORISED since it's fully paid ($0)
      })
      
      if (invoiceResult.success) {
        invoiceNumber = invoiceResult.invoiceNumber
        xeroInvoiceId = invoiceResult.xeroInvoiceId
        console.log(`✅ Created Xero invoice ${invoiceNumber} for free registration (marked as AUTHORISED)`)
      } else {
        console.warn(`⚠️ Failed to create Xero invoice for free registration: ${invoiceResult.error}`)
      }
    } catch (error) {
      console.warn('⚠️ Error creating Xero invoice for free registration:', error)
      
      // Capture Xero invoice creation errors in Sentry for visibility
      Sentry.withScope((scope) => {
        scope.setTag('integration', 'xero')
        scope.setTag('operation', 'free_registration_invoice')
        scope.setTag('user_id', user.id)
        scope.setLevel('warning') // Non-critical since payment still succeeds
        scope.setContext('free_registration_invoice_error', {
          user_id: user.id,
          registration_id: registrationId,
          category_id: categoryId,
          discount_code: discountCode,
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        
        if (error instanceof Error) {
          Sentry.captureException(error)
        } else {
          Sentry.captureMessage(`Free registration Xero invoice creation failed: ${error}`, 'warning')
        }
      })
    }

    // Create payment record with $0 amount and completed status
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: 0,
        final_amount: 0,
        stripe_payment_intent_id: null, // No Stripe payment for free
        status: 'completed',
        payment_method: 'free',
      })
      .select()
      .single()

    if (paymentError) {
      capturePaymentError(paymentError, paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to create payment record' }, { status: 500 })
    }

    // Create payment item record
    const { error: paymentItemError } = await supabase
      .from('payment_items')
      .insert({
        payment_id: paymentRecord.id,
        item_type: 'registration',
        item_id: registrationId,
        amount: 0,
      })

    if (paymentItemError) {
      console.error('Error creating payment item record:', paymentItemError)
      capturePaymentError(paymentItemError, paymentContext, 'warning')
    }


    // Update the registration to paid status (complete the reservation)
    const { error: updateError } = await adminSupabase
      .from('user_registrations')
      .update({
        payment_status: 'paid',
        amount_paid: 0,
        registered_at: new Date().toISOString(),
        reservation_expires_at: null,
      })
      .eq('id', reservationData.id)

    if (updateError) {
      capturePaymentError(updateError, paymentContext, 'error')
      return NextResponse.json({ error: 'Failed to complete registration' }, { status: 500 })
    }

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

    // Log successful operation
    capturePaymentSuccess('free_registration_creation', paymentContext, Date.now() - startTime)

    // Return success without client secret (no Stripe payment needed)
    return NextResponse.json({
      success: true,
      paymentIntentId: null,
      isFree: true,
      message: 'Free registration completed successfully',
      invoiceNumber: invoiceNumber || undefined,
      xeroInvoiceId: xeroInvoiceId || undefined
    })

  } catch (error) {
    console.error('Error handling free registration:', error)
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
    const paymentContext = {
      userId: user.id,
      userEmail: user.email,
      registrationId: registrationId,
      categoryId: categoryId,
      amountCents: amount,
      discountCode: discountCode,
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

    // Fetch registration details with category and season info
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
      cat => cat.id === categoryId
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
        console.error('Error validating discount code:', discountError)
        capturePaymentError(discountError, paymentContext, 'warning')
        return NextResponse.json({ 
          error: 'Failed to validate discount code' 
        }, { status: 500 })
      }
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
            console.log(`🔍 Checking Stripe status for payment intent: ${processingRecord.stripe_payment_intent_id}`)
            const paymentIntent = await stripe.paymentIntents.retrieve(processingRecord.stripe_payment_intent_id)
            
            if (paymentIntent.status === 'succeeded') {
              // Payment succeeded but our DB wasn't updated - fix it
              console.log(`✅ Payment succeeded, updating DB to paid status`)
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
              console.log(`❌ Payment ${paymentIntent.status}, cleaning up processing record`)
              await adminSupabase
                .from('user_registrations')
                .delete()
                .eq('id', processingRecord.id)
                .eq('payment_status', 'processing')
              
              console.log(`🔄 Payment failed in Stripe, allowing user to retry`)
              // Continue with new payment attempt
              
            } else {
              // Payment still processing in Stripe - block retry
              capturePaymentError(new Error('Payment currently processing in Stripe'), paymentContext, 'warning')
              return NextResponse.json({ 
                error: `Your payment is currently being processed by Stripe. Please wait for it to complete before trying again.`
              }, { status: 409 })
            }
            
          } catch (stripeError) {
            console.error('Error checking Stripe payment intent status:', stripeError)
            // If we can't check Stripe, be conservative and block
            capturePaymentError(new Error('Unable to verify payment status'), paymentContext, 'warning')
            return NextResponse.json({ 
              error: `Unable to verify your payment status. Please wait a moment and try again.`
            }, { status: 409 })
          }
        } else {
          // Processing record without Stripe ID - likely corrupted, clean it up
          console.log(`🧹 Cleaning up processing record without Stripe payment intent ID`)
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
        console.log(`🔄 Updating existing awaiting_payment record with fresh timer: ${existingRecord.id}`)
        
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
          console.error(`Error updating awaiting_payment record:`, updateError)
          // Fall through to create new record
        } else {
          console.log(`✅ Updated awaiting_payment record with fresh timer`)
          // Skip creating new record, continue with payment intent creation for existing record
          reservationId = existingRecord.id
        }
      }
      
      // Handle 'failed' records - reuse the most recent failed record for retry
      if (failedRecords.length > 0) {
        const failedRecord = failedRecords[0] // Use most recent failed record
        console.log(`🔄 Found failed payment record - reusing for retry attempt: ${failedRecord.id}`)
        
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
          console.error(`Error updating failed record:`, updateError)
          // Fall through to create new record
        } else {
          console.log(`✅ Updated failed record for retry with fresh timer`)
          // Skip creating new record, continue with payment intent creation for existing record
          reservationId = failedRecord.id
        }
      }
    } catch (cleanupError) {
      console.error('Error cleaning up existing processing records:', cleanupError)
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
        console.error('Reservation creation error:', reservationError)
        
        // Check if this is a duplicate registration error
        if (reservationError.code === '23505') { // Unique constraint violation
          // Check what type of existing registration exists
          const { data: existingReg } = await supabase
            .from('user_registrations')
            .select('payment_status')
            .eq('user_id', user.id)
            .eq('registration_id', registrationId)
            .single()
          
          console.log('Existing registration found:', existingReg)
          
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
        console.log(`✅ Using existing updated record as reservation: ${reservationId}`)
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
      console.error('Error creating payment record:', paymentError)
      // Log warning but don't fail the request since Stripe intent was created
      capturePaymentError(paymentError, paymentContext, 'warning')
    } else if (paymentRecord) {
      console.log(`✅ Created payment record: ${paymentRecord.id} for Stripe payment intent: ${paymentIntent.id}`)
      // Create payment item record for the registration
      const { error: paymentItemError } = await supabase
        .from('payment_items')
        .insert({
          payment_id: paymentRecord.id,
          item_type: 'registration',
          item_id: registrationId,
          amount: finalAmount,
        })

      if (paymentItemError) {
        console.error('Error creating payment item record:', paymentItemError)
        capturePaymentError(paymentItemError, paymentContext, 'warning')
      }
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
    console.error('Error creating registration payment intent:', error)
    
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