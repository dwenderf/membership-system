import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createXeroInvoiceBeforePayment, PrePaymentInvoiceData } from '@/lib/xero-invoices'

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

    // Create Xero invoice for zero payment
    let invoiceNumber = null
    let xeroInvoiceId = null
    
    try {
      // Build invoice data for Xero
      const paymentItems = [{
        item_type: 'membership' as const,
        item_id: membershipId,
        amount: 0, // $0 for free membership
        description: `${membership.name} - ${durationMonths} months${paymentOption === 'assistance' ? ' (Financial Assistance)' : ''}`,
        accounting_code: membership.accounting_code
      }]

      // Add donation item if applicable (even for $0 memberships, someone might donate)
      if (paymentOption === 'donation' && donationAmount && donationAmount > 0) {
        paymentItems.push({
          item_type: 'donation' as const,
          item_id: membershipId,
          amount: donationAmount,
          description: 'Donation',
          accounting_code: undefined
        })
      }

      const xeroInvoiceData: PrePaymentInvoiceData = {
        user_id: user.id,
        total_amount: donationAmount || 0, // Only donation amount for free membership
        discount_amount: 0,
        final_amount: donationAmount || 0,
        payment_items: paymentItems,
        discount_codes_used: [] // TODO: Add discount codes when implemented
      }

      const invoiceResult = await createXeroInvoiceBeforePayment(xeroInvoiceData, { 
        markAsAuthorised: true // Mark as AUTHORISED since it's fully paid ($0 + optional donation)
      })
      
      if (invoiceResult.success) {
        invoiceNumber = invoiceResult.invoiceNumber
        xeroInvoiceId = invoiceResult.xeroInvoiceId
        console.log(`✅ Created Xero invoice ${invoiceNumber} for free membership (marked as AUTHORISED)`)
      } else {
        console.warn(`⚠️ Failed to create Xero invoice for free membership: ${invoiceResult.error}`)
      }
    } catch (error) {
      console.warn('⚠️ Error creating Xero invoice for free membership:', error)
    }

    // Create payment record with $0 amount and completed status
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        total_amount: donationAmount || 0,
        final_amount: donationAmount || 0,
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
      console.error('Error creating payment item records:', paymentItemError)
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
      message: 'Free membership created successfully',
      invoiceNumber: invoiceNumber || undefined,
      xeroInvoiceId: xeroInvoiceId || undefined
    })

  } catch (error) {
    console.error('Error handling free membership:', error)
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
      console.error('Error creating payment record:', paymentError)
      // Log warning but don't fail the request since Stripe intent was created
      capturePaymentError(paymentError, paymentContext, 'warning')
    } else if (paymentRecord) {
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
        console.error('Error creating payment item records:', paymentItemError)
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
    console.error('Error creating payment intent:', error)
    
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