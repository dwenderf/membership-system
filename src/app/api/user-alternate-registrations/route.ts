import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registration_id, discount_code_id } = body
    


    if (!registration_id) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 })
    }

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
    const adminSupabase = createAdminClient()
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('stripe_payment_method_id, setup_intent_status')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (!userProfile?.stripe_payment_method_id || userProfile.setup_intent_status !== 'succeeded') {

      
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
      console.error('Error creating alternate registration:', insertError)
      return NextResponse.json({ error: 'Failed to register as alternate' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      alternateRegistration,
      message: 'Successfully registered as alternate'
    })

  } catch (error) {
    console.error('Error in alternate registration:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
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
        discount_code:discount_codes(code, discount_amount, discount_type)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching alternate registrations:', error)
      return NextResponse.json({ error: 'Failed to fetch alternate registrations' }, { status: 500 })
    }

    return NextResponse.json(alternateRegistrations)

  } catch (error) {
    console.error('Error in GET alternate registrations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}