import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { getSingleCategoryRegistrationCount } from '@/lib/registration-counts'
import { getBaseUrl } from '@/lib/url-utils'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'
import { setPaymentContext, capturePaymentError, capturePaymentSuccess } from '@/lib/sentry-helpers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
})

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
    const { registrationId, categoryId, amount, presaleCode } = body
    
    // Set payment context for Sentry
    const paymentContext = {
      userId: user.id,
      userEmail: user.email,
      registrationId: registrationId,
      categoryId: categoryId,
      amountCents: amount,
      endpoint: '/api/create-registration-payment-intent',
      operation: 'registration_payment_intent_creation'
    }
    setPaymentContext(paymentContext)

    // Validate required fields
    if (!registrationId || !categoryId || !amount) {
      const error = new Error('Missing required fields: registrationId, categoryId, amount')
      capturePaymentError(error, paymentContext, 'warning')
      
      return NextResponse.json(
        { error: 'Missing required fields: registrationId, categoryId, amount' },
        { status: 400 }
      )
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

    // STEP 1: Reserve spot immediately (race condition protection)
    let reservationId: string | null = null
    
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
          amount_paid: amount,
          presale_code_used: presaleCode || null,
        })
        .select()
        .single()

      if (reservationError) {
        // Check if this is a duplicate registration error
        if (reservationError.code === '23505') { // Unique constraint violation
          return NextResponse.json({ 
            error: 'You are already registered for this event' 
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
      console.log(`Reserved spot for user ${user.id}, reservation ID: ${reservationId}, expires: ${expiresAt.toISOString()}`)
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
      amount: amount, // Amount in cents
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
      },
      description: `${registration.name} - ${categoryName} (${registration.season?.name})`,
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
        final_amount: amount,
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
          amount: amount,
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