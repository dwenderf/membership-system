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
        payment_status: 'processing',
        processing_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
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

    // Create Xero invoice BEFORE payment record (even for $0 registrations)
    let invoiceNumber = null
    let xeroInvoiceId = null
    
    try {
      // Get registration and category details for invoice
      const registrationCategory = registration.registration_categories.find((rc: any) => rc.id === categoryId)
      
      if (!registrationCategory) {
        throw new Error('Registration category not found')
      }
      
      // Build invoice data for Xero
      const paymentItems = [{
        item_type: 'registration' as const,
        item_id: registrationId,
        amount: 0, // $0 for free registration
        description: `Registration: ${registration.name} - ${registrationCategory.category?.name || registrationCategory.custom_name}`,
        accounting_code: registrationCategory.accounting_code || registration.accounting_code
      }]

      // Add discount line items if applicable
      const discountItems = []
      if (discountCode) {
        // TODO: Calculate discount amount based on discount code
        // For now, assume 100% discount for free registrations
        discountItems.push({
          code: discountCode,
          amount_saved: registrationCategory.price || 0, // Original price
          category_name: 'Registration Discount',
          accounting_code: undefined // Will use default discount accounting code
        })
      }

      const xeroInvoiceData: PrePaymentInvoiceData = {
        user_id: user.id,
        total_amount: registrationCategory.price || 0, // Original price
        discount_amount: registrationCategory.price || 0, // Full discount
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

    // Update Xero invoice with payment_id and mark as synced (since it's fully paid)
    if (paymentRecord && xeroInvoiceId) {
      try {
        await supabase
          .from('xero_invoices')
          .update({ 
            payment_id: paymentRecord.id,
            sync_status: 'synced', // Mark as synced since payment is complete
            last_synced_at: new Date().toISOString()
          })
          .eq('xero_invoice_id', xeroInvoiceId)
        
        console.log(`✅ Linked free registration payment ${paymentRecord.id} to Xero invoice ${invoiceNumber}`)
      } catch (linkError) {
        console.error('⚠️ Failed to link free registration payment to Xero invoice:', linkError)
      }
    }

    // Update the registration to paid status (complete the reservation)
    const { error: updateError } = await adminSupabase
      .from('user_registrations')
      .update({
        payment_status: 'paid',
        amount_paid: 0,
        registered_at: new Date().toISOString(),
        processing_expires_at: null,
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
      invoiceNumber: invoiceNumber || undefined, // Include invoice number if created
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

    // Check if user already registered or has active reservation via centralized API
    try {
      const duplicateCheckResponse = await fetch(`${getBaseUrl()}/api/check-duplicate-registration?registrationId=${registrationId}`, {
        headers: {
          'Cookie': request.headers.get('cookie') || '',
        },
      })
      
      if (duplicateCheckResponse.ok) {
        const duplicateCheck = await duplicateCheckResponse.json()
        
        if (duplicateCheck.isAlreadyRegistered) {
          capturePaymentError(new Error('User already registered (paid)'), paymentContext, 'warning')
          return NextResponse.json({ error: 'You are already registered for this event' }, { status: 400 })
        }
        
        if (duplicateCheck.hasActiveReservation) {
          const expiresAt = new Date(duplicateCheck.expiresAt)
          const minutesLeft = Math.ceil((expiresAt.getTime() - new Date().getTime()) / (1000 * 60))
          
          capturePaymentError(new Error('User has active payment reservation'), paymentContext, 'warning')
          return NextResponse.json({ 
            error: `You have a payment in progress for this event. Please complete your payment or wait ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} to try again.`,
            reservationExpiresAt: duplicateCheck.expiresAt,
            reservationId: duplicateCheck.registrationId
          }, { status: 409 }) // 409 Conflict for reservation in progress
        }
      }
    } catch (error) {
      console.error('Error checking duplicate registration:', error)
      // Continue without duplicate check rather than fail the entire request
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

    // STEP 1: Reserve spot immediately (race condition protection)
    let reservationId: string | null = null
    
    if (selectedCategory.max_capacity) {
      // Clean up any existing processing records for this user/registration first
      try {
        // Use admin client to bypass RLS for cleanup operations
        const adminSupabase = createAdminClient()
        
        // First check what records exist
        const { data: existingRecords } = await adminSupabase
          .from('user_registrations')
          .select('id, payment_status, processing_expires_at')
          .eq('user_id', user.id)
          .eq('registration_id', registrationId)
        
        console.log('Existing records before cleanup:', existingRecords)
        
        // Delete processing records directly using admin client
        const processingRecords = existingRecords?.filter(r => r.payment_status === 'processing') || []
        
        for (const record of processingRecords) {
          const { data: deletedRecord, error: deleteError } = await adminSupabase
            .from('user_registrations')
            .delete()
            .eq('id', record.id)
            .eq('payment_status', 'processing')
            .select()
          
          console.log(`Delete processing record result for ${record.id}:`, { deletedRecord, deleteError })
        }
        
        console.log(`Successfully cleaned up ${processingRecords.length} processing records using admin client`)
      } catch (cleanupError) {
        console.error('Error cleaning up existing processing records:', cleanupError)
        // Continue anyway - the insert will handle duplicates
      }
      
      // Get current count including active reservations
      const currentCount = await getSingleCategoryRegistrationCount(categoryId)
      
      if (currentCount >= selectedCategory.max_capacity) {
        capturePaymentError(new Error('Registration full'), paymentContext, 'warning')
        return NextResponse.json({ 
          error: 'This category is at capacity',
          shouldShowWaitlist: true 
        }, { status: 400 })
      }

      // Create processing reservation (5 minute expiration)
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes from now
      
      const { data: reservation, error: reservationError } = await supabase
        .from('user_registrations')
        .insert({
          user_id: user.id,
          registration_id: registrationId,
          registration_category_id: categoryId,
          payment_status: 'processing',
          processing_expires_at: expiresAt.toISOString(),
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
      }

      reservationId = reservation.id
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
      description: `${registration.name} - ${categoryName} (${registration.season?.name})${discountAmount > 0 ? ` - Discount: $${(discountAmount / 100).toFixed(2)}` : ''}`,
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