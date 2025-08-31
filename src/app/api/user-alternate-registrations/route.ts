import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { SetupIntentService } from '@/lib/services/setup-intent-service'
import { logger } from '@/lib/logging/logger'

// GET /api/user-alternate-registrations - Get user's alternate registrations
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's alternate registrations with registration details
    const { data: alternateRegistrations, error } = await supabase
      .from('user_alternate_registrations')
      .select(`
        id,
        registered_at,
        discount_code_id,
        registrations!inner (
          id,
          name,
          alternate_price,
          seasons (
            name,
            start_date,
            end_date
          )
        ),
        discount_codes (
          code,
          discount_type,
          discount_value
        )
      `)
      .eq('user_id', authUser.id)
      .order('registered_at', { ascending: false })

    if (error) {
      logger.logSystem('get-alternate-registrations-error', 'Failed to fetch user alternate registrations', {
        userId: authUser.id,
        error: error.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to fetch alternate registrations' 
      }, { status: 500 })
    }

    // Get user's payment method status
    const { data: user } = await supabase
      .from('users')
      .select('stripe_payment_method_id, setup_intent_status')
      .eq('id', authUser.id)
      .single()

    const hasValidPaymentMethod = user?.stripe_payment_method_id && user?.setup_intent_status === 'succeeded'

    return NextResponse.json({
      alternateRegistrations: alternateRegistrations || [],
      paymentMethodStatus: {
        hasValidPaymentMethod,
        message: hasValidPaymentMethod 
          ? 'Payment method is set up and ready for alternate selection'
          : 'Payment method setup required for alternate selection'
      }
    })

  } catch (error) {
    logger.logSystem('get-alternate-registrations-error', 'Unexpected error fetching alternate registrations', {
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

// POST /api/user-alternate-registrations - Register user as alternate for a registration
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registrationId, discountCodeId } = body

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 })
    }

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, stripe_setup_intent_id, stripe_payment_method_id, setup_intent_status')
      .eq('id', authUser.id)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get registration details
    const { data: registration, error: registrationError } = await supabase
      .from('registrations')
      .select('id, name, allow_alternates, alternate_price, alternate_accounting_code, season_id')
      .eq('id', registrationId)
      .single()

    if (registrationError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Check if registration allows alternates
    if (!registration.allow_alternates) {
      return NextResponse.json({ 
        error: 'This registration does not allow alternates' 
      }, { status: 400 })
    }

    // Check if user is already registered as a regular participant
    const { data: existingRegistration } = await supabase
      .from('user_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('payment_status', 'paid')
      .single()

    if (existingRegistration) {
      return NextResponse.json({ 
        error: 'You are already registered as a regular participant for this registration' 
      }, { status: 400 })
    }

    // Check if user is already registered as an alternate
    const { data: existingAlternate } = await supabase
      .from('user_alternate_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .single()

    if (existingAlternate) {
      return NextResponse.json({ 
        error: 'You are already registered as an alternate for this registration' 
      }, { status: 400 })
    }

    // Validate discount code if provided
    let discountCode = null
    if (discountCodeId) {
      const { data: discount, error: discountError } = await supabase
        .from('discount_codes')
        .select(`
          *,
          category:discount_categories(*)
        `)
        .eq('id', discountCodeId)
        .single()

      if (discountError || !discount) {
        return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 })
      }

      // Check if discount code is active
      if (!discount.is_active) {
        return NextResponse.json({ error: 'Discount code is not active' }, { status: 400 })
      }

      // Check if discount code is valid for this season
      if (discount.season_id && discount.season_id !== registration.season_id) {
        return NextResponse.json({ error: 'Discount code is not valid for this season' }, { status: 400 })
      }

      // Check usage limits
      if (discount.usage_limit && discount.usage_limit > 0) {
        const { data: usageCount } = await supabase
          .from('discount_usage')
          .select('id')
          .eq('user_id', user.id)
          .eq('discount_code_id', discountCodeId)

        const currentUsage = usageCount?.length || 0
        
        if (currentUsage >= discount.usage_limit) {
          return NextResponse.json({ 
            error: 'You have exceeded the usage limit for this discount code' 
          }, { status: 400 })
        }
      }

      discountCode = discount
    }

    // Check if user has a valid payment method, create Setup Intent if needed
    let setupIntentClientSecret = null
    
    if (!user.stripe_payment_method_id || user.setup_intent_status !== 'succeeded') {
      try {
        // Create new Setup Intent
        const setupIntentResult = await SetupIntentService.createSetupIntent(user.id)
        setupIntentClientSecret = setupIntentResult.clientSecret

        logger.logPaymentProcessing(
          'setup-intent-created-for-alternate',
          'Created Setup Intent for alternate registration',
          {
            userId: user.id,
            registrationId,
            setupIntentId: setupIntentResult.setupIntentId
          },
          'info'
        )
      } catch (setupError) {
        logger.logPaymentProcessing(
          'setup-intent-creation-failed',
          'Failed to create Setup Intent for alternate registration',
          {
            userId: user.id,
            registrationId,
            error: setupError instanceof Error ? setupError.message : String(setupError)
          },
          'error'
        )
        
        return NextResponse.json({ 
          error: 'Failed to set up payment method. Please try again.' 
        }, { status: 500 })
      }
    }

    // Create alternate registration record
    const { data: alternateRegistration, error: insertError } = await supabase
      .from('user_alternate_registrations')
      .insert({
        user_id: user.id,
        registration_id: registrationId,
        discount_code_id: discountCodeId || null,
        registered_at: new Date().toISOString()
      })
      .select()
      .single()

    if (insertError) {
      logger.logSystem('alternate-registration-failed', 'Failed to create alternate registration', {
        userId: user.id,
        registrationId,
        error: insertError.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to register as alternate. Please try again.' 
      }, { status: 500 })
    }

    logger.logSystem('alternate-registration-created', 'User registered as alternate', {
      userId: user.id,
      registrationId,
      alternateRegistrationId: alternateRegistration.id,
      hasDiscountCode: !!discountCodeId,
      needsPaymentSetup: !!setupIntentClientSecret
    })

    // Return response
    const response: any = {
      success: true,
      alternateRegistration: {
        id: alternateRegistration.id,
        registrationId,
        registrationName: registration.name,
        registeredAt: alternateRegistration.registered_at
      },
      message: 'Successfully registered as alternate'
    }

    // Include Setup Intent client secret if payment method setup is needed
    if (setupIntentClientSecret) {
      response.setupIntent = {
        clientSecret: setupIntentClientSecret,
        message: 'Please complete payment method setup to enable alternate selection'
      }
    }

    return NextResponse.json(response)

  } catch (error) {
    logger.logSystem('alternate-registration-error', 'Unexpected error in alternate registration', {
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}