import { createClient, createAdminClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/date-utils'

import { NextRequest, NextResponse } from 'next/server'
import { WaitlistPaymentService } from '@/lib/services/waitlist-payment-service'
import { logger } from '@/lib/logging/logger'
import { emailService } from '@/lib/email'

// POST /api/waitlists/[waitlistId]/select - Select a user from waitlist
export async function POST(
  request: NextRequest,
  { params }: { params: { waitlistId: string } }
) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const waitlistId = params.waitlistId

    // Parse request body for optional price override
    const body = await request.json().catch(() => ({}))
    const overridePrice = body.overridePrice as number | undefined

    // Check if user is admin
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get waitlist entry details
    const { data: waitlistEntry, error: waitlistError } = await supabase
      .from('waitlists')
      .select(`
        id,
        user_id,
        registration_id,
        registration_category_id,
        discount_code_id,
        removed_at,
        users!waitlists_user_id_fkey (
          id,
          first_name,
          last_name,
          email,
          stripe_payment_method_id,
          setup_intent_status
        ),
        registrations!inner (
          id,
          name,
          season_id,
          seasons:season_id (
            name,
            start_date,
            end_date
          )
        ),
        registration_categories!inner (
          id,
          custom_name,
          price,
          accounting_code,
          categories (
            name
          )
        )
      `)
      .eq('id', waitlistId)
      .single()

    if (waitlistError || !waitlistEntry) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    // Check if already removed from waitlist
    if (waitlistEntry.removed_at) {
      return NextResponse.json({
        error: 'This waitlist entry has already been processed'
      }, { status: 400 })
    }

    // Extract related data
    const user = Array.isArray(waitlistEntry.users) ? waitlistEntry.users[0] : waitlistEntry.users
    const registration = Array.isArray(waitlistEntry.registrations) ? waitlistEntry.registrations[0] : waitlistEntry.registrations
    const category = Array.isArray(waitlistEntry.registration_categories) ? waitlistEntry.registration_categories[0] : waitlistEntry.registration_categories
    const season = registration?.seasons ? (Array.isArray(registration.seasons) ? registration.seasons[0] : registration.seasons) : null
    const masterCategory = category?.categories ? (Array.isArray(category.categories) ? category.categories[0] : category.categories) : null

    const categoryName = masterCategory?.name || category?.custom_name || 'Unknown Category'

    // Validate override price if provided
    if (overridePrice !== undefined) {
      if (overridePrice < 0 || overridePrice > category.price) {
        return NextResponse.json({
          error: `Override price must be between $0.00 and $${(category.price / 100).toFixed(2)}`
        }, { status: 400 })
      }
    }

    // Determine effective base price (before discounts)
    const effectiveBasePrice = overridePrice !== undefined ? overridePrice : category.price

    // Only validate payment method if payment will be required
    // (skip for zero-cost registrations)
    if (effectiveBasePrice > 0) {
      if (!user?.stripe_payment_method_id || user?.setup_intent_status !== 'succeeded') {
        return NextResponse.json({
          error: 'User does not have a valid payment method'
        }, { status: 400 })
      }
    }

    // Check if user is already registered for this registration (only check active/paid registrations)
    const { data: existingRegistration } = await supabase
      .from('user_registrations')
      .select('id')
      .eq('user_id', waitlistEntry.user_id)
      .eq('registration_id', waitlistEntry.registration_id)
      .eq('payment_status', 'paid')
      .single()

    if (existingRegistration) {
      return NextResponse.json({
        error: 'User is already registered for this event'
      }, { status: 400 })
    }

    try {
      // Charge the user
      const chargeResult = await WaitlistPaymentService.chargeWaitlistUser(
        waitlistEntry.user_id,
        waitlistEntry.registration_id,
        waitlistEntry.registration_category_id,
        categoryName,
        waitlistEntry.discount_code_id || undefined,
        overridePrice
      )

      if (!chargeResult.success) {
        throw new Error('Payment failed')
      }

      // Create user registration record using admin client to bypass RLS
      console.log('🔍 Creating user_registrations record (WAITLIST selection path)', {
        userId: waitlistEntry.user_id,
        registrationId: waitlistEntry.registration_id,
        categoryId: waitlistEntry.registration_category_id,
        paymentStatus: 'paid',
        endpoint: 'waitlists/select'
      })
      const { data: userRegistration, error: registrationError } = await adminSupabase
        .from('user_registrations')
        .insert({
          user_id: waitlistEntry.user_id,
          registration_id: waitlistEntry.registration_id,
          registration_category_id: waitlistEntry.registration_category_id,
          registration_fee: overridePrice !== undefined ? overridePrice : category.price,
          amount_paid: chargeResult.amountCharged,
          payment_status: 'paid',
          payment_id: chargeResult.paymentId,
          registered_at: new Date().toISOString()
        })
        .select()
        .single()

      if (registrationError) {
        logger.logSystem('registration-creation-failed', 'Failed to create registration after payment', {
          waitlistId,
          userId: waitlistEntry.user_id,
          paymentId: chargeResult.paymentId,
          error: registrationError.message
        })

        return NextResponse.json({
          error: 'Payment succeeded but registration creation failed. Please contact support.',
          paymentId: chargeResult.paymentId
        }, { status: 500 })
      }

      // Mark waitlist entry as removed and record who selected them
      const { error: updateError } = await adminSupabase
        .from('waitlists')
        .update({
          removed_at: new Date().toISOString(),
          selected_by_admin_id: authUser.id
        })
        .eq('id', waitlistId)

      if (updateError) {
        logger.logSystem('waitlist-removal-failed', 'Failed to mark waitlist entry as removed', {
          waitlistId,
          error: updateError.message
        })
      }

      // Get discount code details if applicable
      let discountApplied = ''
      if (waitlistEntry.discount_code_id) {
        const { data: discountCode } = await supabase
          .from('discount_codes')
          .select('code, percentage')
          .eq('id', waitlistEntry.discount_code_id)
          .single()

        if (discountCode) {
          const discountAmount = Math.round((category.price * discountCode.percentage) / 100)
          discountApplied = `${discountCode.code}: -$${(discountAmount / 100).toFixed(2)}`
        }
      }

      // Send confirmation email
      try {
        await emailService.sendWaitlistSelectedNotification({
          userId: waitlistEntry.user_id,
          email: user.email,
          userName: `${user.first_name} ${user.last_name}`,
          registrationName: registration.name,
          categoryName: categoryName,
          seasonName: season ? `${season.name} (${formatDate(new Date(season.start_date))} - ${formatDate(new Date(season.end_date))})` : 'Unknown Season',
          amountCharged: chargeResult.amountCharged,
          paymentIntentId: chargeResult.paymentIntentId,
          discountApplied: discountApplied
        })
      } catch (emailError) {
        // Log email error but don't fail the request
        logger.logSystem('waitlist-selection-email-failed', 'Failed to send waitlist selection email', {
          waitlistId,
          userId: waitlistEntry.user_id,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        })
      }

      logger.logSystem('waitlist-selection-success', 'Successfully selected user from waitlist', {
        waitlistId,
        userId: waitlistEntry.user_id,
        registrationId: waitlistEntry.registration_id,
        categoryId: waitlistEntry.registration_category_id,
        amountCharged: chargeResult.amountCharged,
        selectedBy: authUser.id
      })

      return NextResponse.json({
        success: true,
        message: 'User successfully selected from waitlist',
        userRegistration: {
          id: userRegistration.id,
          userId: waitlistEntry.user_id,
          userName: `${user.first_name} ${user.last_name}`,
          amountCharged: chargeResult.amountCharged,
          registrationName: registration.name,
          categoryName: categoryName
        }
      })

    } catch (error) {
      logger.logSystem('waitlist-selection-error', 'Error processing waitlist selection', {
        waitlistId,
        userId: waitlistEntry.user_id,
        error: error instanceof Error ? error.message : String(error)
      })

      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Failed to process waitlist selection'
      }, { status: 500 })
    }

  } catch (error) {
    logger.logSystem('waitlist-selection-error', 'Unexpected error in waitlist selection', {
      waitlistId: params.waitlistId,
      error: error instanceof Error ? error.message : String(error)
    })

    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
