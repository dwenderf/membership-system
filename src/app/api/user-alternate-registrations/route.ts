import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { userHasValidPaymentMethod } from '@/lib/payment-method-utils'
import { stageCaptainRosterChangeNotification } from '@/lib/email/captain-notifications'
import { stageAdminNewRegistrationNotification } from '@/lib/email/admin-notifications'
import { logger } from '@/lib/logging/logger'
import { logPolicyAcceptance } from '@/lib/policy-acceptance'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registration_id, discount_code_id, policiesAccepted } = body

    if (!registration_id) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 })
    }

    if (policiesAccepted !== true) {
      return NextResponse.json(
        { error: 'You must agree to the Terms and Conditions, Code of Conduct, Concussion Policy, and Privacy Policy' },
        { status: 400 }
      )
    }

    const adminSupabase = createAdminClient()
    await logPolicyAcceptance(adminSupabase, user.id, 'alternate_registration')

    // Check if registration exists and allows alternates
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, name, allow_alternates, alternate_price, alternate_accounting_code')
      .eq('id', registration_id)
      .single()

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (!registration.allow_alternates) {
      return NextResponse.json({ error: 'This registration does not allow alternates' }, { status: 400 })
    }

    // Check if user is already registered as alternate for this registration
    const { data: existingAlternate } = await supabase
      .from('user_alternate_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registration_id)
      .single()

    if (existingAlternate) {
      return NextResponse.json({ error: 'You are already registered as an alternate for this registration' }, { status: 400 })
    }

    // Validate discount code if provided
    let validatedDiscountCodeId = null
    if (discount_code_id) {
      const { data: discountCode, error: discountError } = await supabase
        .from('discount_codes')
        .select('id, code, is_active')
        .eq('id', discount_code_id)
        .single()

      if (discountError || !discountCode || !discountCode.is_active) {
        return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 })
      }

      validatedDiscountCodeId = discount_code_id
    }

    // Check if user has a saved payment method (Setup Intent) using admin client to bypass RLS
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('stripe_payment_method_id, setup_intent_status')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (!userHasValidPaymentMethod(userProfile)) {
      return NextResponse.json({
        error: 'You need to set up a payment method before registering as an alternate',
        requiresSetupIntent: true
      }, { status: 400 })
    }

    // Create the alternate registration
    const { data: alternateRegistration, error: insertError } = await supabase
      .from('user_alternate_registrations')
      .insert({
        user_id: user.id,
        registration_id: registration_id,
        discount_code_id: validatedDiscountCodeId
      })
      .select()
      .single()

    if (insertError) {
      logger.logPaymentProcessing('alternate-registration-create-failed', 'Error creating alternate registration', { userId: user.id, registrationId: registration_id, error: insertError.message }, 'error')
      return NextResponse.json({ error: 'Failed to register as alternate' }, { status: 500 })
    }

    // Notify opted-in captains and admins of the new alternate sign-up (fire-and-forget)
    const now = alternateRegistration.created_at ?? new Date().toISOString()
    stageCaptainRosterChangeNotification(
      registration_id,
      user.id,
      'alternate joined',
      'Alternate',
      now,
      0 // no upfront payment for alternates
    ).catch((err) => logger.logPaymentProcessing('alternate-captain-notification-failed', 'Captain notification failed for new alternate registration (non-fatal)', { registrationId: registration_id, userId: user.id, error: err instanceof Error ? err.message : String(err) }, 'warn'))

    stageAdminNewRegistrationNotification(
      registration_id,
      user.id,
      null, // no payment ID for alternate sign-ups
      null, // no category for alternate sign-ups
      true, // isAlternate
      now,
      0
    ).catch((err) => logger.logPaymentProcessing('alternate-admin-notification-failed', 'Admin notification failed for new alternate registration (non-fatal)', { registrationId: registration_id, userId: user.id, error: err instanceof Error ? err.message : String(err) }, 'warn'))

    return NextResponse.json({
      success: true,
      alternateRegistration,
      message: 'Successfully registered as alternate'
    })

  } catch (error) {
    logger.logPaymentProcessing('alternate-registration-error', 'Error in alternate registration', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's alternate registrations
    const { data: alternateRegistrations, error } = await supabase
      .from('user_alternate_registrations')
      .select(`
        *,
        registration:registrations(
          id,
          name,
          allow_alternates,
          alternate_price,
          alternate_accounting_code,
          season:seasons(name, start_date, end_date)
        ),
        discount_code:discount_codes(code, percentage)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      logger.logPaymentProcessing('alternate-registrations-fetch-failed', 'Error fetching alternate registrations', { userId: user.id, error: error.message }, 'error')
      return NextResponse.json({ error: 'Failed to fetch alternate registrations' }, { status: 500 })
    }

    return NextResponse.json(alternateRegistrations)

  } catch (error) {
    logger.logPaymentProcessing('alternate-registrations-get-error', 'Error in GET alternate registrations', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}