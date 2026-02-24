import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SetupIntentService } from '@/lib/services/setup-intent-service'
import { logger } from '@/lib/logging/logger'
import { userHasValidPaymentMethod } from '@/lib/services/payment-method-service'

/**
 * Create or retrieve Setup Intent for user payment method
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user already has a valid Setup Intent
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('stripe_setup_intent_id, setup_intent_status, stripe_payment_method_id')
      .eq('id', user.id)
      .single()

    if (userError) {
      logger.logPaymentProcessing(
        'setup-intent-user-fetch-failed',
        'Failed to fetch user data for Setup Intent',
        { 
          userId: user.id,
          error: userError.message
        },
        'error'
      )
      return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 })
    }

    // If user already has a payment method saved, return existing info (no need for new setup intent)
    if (userHasValidPaymentMethod(userData)) {
      const paymentMethod = await SetupIntentService.getUserPaymentMethod(user.id)
      if (paymentMethod) {
        return NextResponse.json({
          hasPaymentMethod: true,
          paymentMethod: paymentMethod,
          message: 'Payment method already set up'
        })
      }
    }

    // Create new Setup Intent
    const result = await SetupIntentService.createSetupIntent(user.id)

    logger.logPaymentProcessing(
      'setup-intent-api-success',
      'Successfully created Setup Intent via API',
      { 
        userId: user.id,
        setupIntentId: result.setupIntent.id
      },
      'info'
    )

    return NextResponse.json({
      clientSecret: result.clientSecret,
      setupIntentId: result.setupIntent.id,
      hasPaymentMethod: false
    })
  } catch (error) {
    logger.logPaymentProcessing(
      'setup-intent-api-failed',
      'Failed to create Setup Intent via API',
      { 
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )

    return NextResponse.json(
      { error: 'Failed to create Setup Intent' },
      { status: 500 }
    )
  }
}

/**
 * Get user's current payment method info
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paymentMethod = await SetupIntentService.getUserPaymentMethod(user.id)

    return NextResponse.json({
      hasPaymentMethod: !!paymentMethod,
      paymentMethod: paymentMethod
    })
  } catch (error) {
    logger.logPaymentProcessing(
      'get-payment-method-api-failed',
      'Failed to get payment method via API',
      { 
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )

    return NextResponse.json(
      { error: 'Failed to get payment method' },
      { status: 500 }
    )
  }
}

/**
 * Remove user's payment method authorization
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's current payment method
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('stripe_payment_method_id')
      .eq('id', user.id)
      .single()

    if (userError || !userData.stripe_payment_method_id) {
      return NextResponse.json({ error: 'No payment method found' }, { status: 404 })
    }

    // Remove payment method
    await SetupIntentService.detachPaymentMethod(userData.stripe_payment_method_id, user.id)

    logger.logPaymentProcessing(
      'payment-method-removal-api-success',
      'Successfully removed payment method via API',
      { 
        userId: user.id,
        paymentMethodId: userData.stripe_payment_method_id
      },
      'info'
    )

    return NextResponse.json({
      success: true,
      message: 'Payment method removed successfully'
    })
  } catch (error) {
    logger.logPaymentProcessing(
      'payment-method-removal-api-failed',
      'Failed to remove payment method via API',
      { 
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )

    return NextResponse.json(
      { error: 'Failed to remove payment method' },
      { status: 500 }
    )
  }
}