import { NextRequest, NextResponse } from 'next/server'
import { formatDate } from '@/lib/date-utils'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'
import { RegistrationValidationService } from '@/lib/services/registration-validation-service'
import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging/logger'
import { logPolicyAcceptance } from '@/lib/policy-acceptance'


// Force import server config

import * as Sentry from '@sentry/nextjs'
import { scheduleSentryFlush } from '@/lib/sentry-flush'

/** Row shape of `waitlists`, as inserted/updated below (not in generated Supabase types). */
interface WaitlistRow {
  id: string
  user_id: string
  registration_id: string
  registration_category_id: string
  position: number
  discount_code_id: string | null
  removed_at: string | null
  joined_at: string
}

// Helper function to get next waitlist position
async function getNextPosition(supabase: SupabaseClient, registrationId: string, categoryId: string): Promise<number> {
  const { data: maxPosition } = await supabase
    .from('waitlists')
    .select('position')
    .eq('registration_id', registrationId)
    .eq('registration_category_id', categoryId)
    .is('removed_at', null)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  return maxPosition ? maxPosition.position + 1 : 1
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registrationId, categoryId, discountCodeId, policiesAccepted } = body

    // Validate required fields
    if (!registrationId || !categoryId) {
      return NextResponse.json(
        { error: 'Missing required fields: registrationId, categoryId' },
        { status: 400 }
      )
    }

    if (policiesAccepted !== true) {
      return NextResponse.json(
        { error: 'You must agree to the Terms and Conditions, Code of Conduct, Concussion Policy, and Privacy Policy' },
        { status: 400 }
      )
    }

    await logPolicyAcceptance(adminSupabase, user.id, 'waitlist_join')

    // Check if user has a saved payment method (required for waitlist)
    const paymentMethodId = await getUserSavedPaymentMethodId(user.id, adminSupabase)
    if (!paymentMethodId) {
      return NextResponse.json({
        error: 'You need to set up a payment method before joining the waitlist',
        requiresSetupIntent: true
      }, { status: 400 })
    }

    // Validate discount code if provided
    let validatedDiscountCodeId = null
    if (discountCodeId) {
      const { data: discountCode, error: discountError } = await supabase
        .from('discount_codes')
        .select('id, code, is_active, valid_from, valid_until')
        .eq('id', discountCodeId)
        .single()

      if (discountError || !discountCode) {
        return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 })
      }

      if (!discountCode.is_active) {
        return NextResponse.json({ error: 'Discount code is not active' }, { status: 400 })
      }

      // Check date validity
      const now = new Date()
      if (discountCode.valid_from && new Date(discountCode.valid_from) > now) {
        return NextResponse.json({ error: 'Discount code is not yet valid' }, { status: 400 })
      }
      if (discountCode.valid_until && new Date(discountCode.valid_until) < now) {
        return NextResponse.json({ error: 'Discount code has expired' }, { status: 400 })
      }

      validatedDiscountCodeId = discountCodeId
    }

    // Get category details to verify it exists and is at capacity
    const { data: category, error: categoryError } = await supabase
      .from('registration_categories')
      .select(`
        id,
        max_capacity,
        custom_name,
        category_id,
        accounting_code,
        required_membership_id,
        sort_order,
        registration_id,
        categories:category_id (is_goalie_only)
      `)
      .eq('id', categoryId)
      .single()

    if (categoryError || !category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Get registration-level membership requirement and season end date
    const { data: registrationRequirements, error: registrationRequirementsError } = await supabase
      .from('registrations')
      .select(`
        required_membership_id,
        seasons:season_id ( end_date )
      `)
      .eq('id', registrationId)
      .single()

    if (registrationRequirementsError || !registrationRequirements) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Check membership eligibility using hierarchical validation
    // Users can qualify with EITHER registration-level OR category-level membership
    const registrationMembershipId = registrationRequirements.required_membership_id || null
    const categoryMembershipId = category.required_membership_id || null

    if (registrationMembershipId || categoryMembershipId) {
      // The `seasons` relation is a single joined object at runtime; the untyped
      // client can't infer relation cardinality and types it as an array.
      const season = registrationRequirements.seasons as unknown as { end_date: string } | null

      const membershipValidation = await RegistrationValidationService.validateMembershipRequirementAsync(
        supabase,
        registrationMembershipId,
        categoryMembershipId,
        user.id,
        season?.end_date ?? ''
      )

      if (!membershipValidation.hasRequiredMembership) {
        return NextResponse.json({
          error: membershipValidation.error || 'Required membership not found'
        }, { status: 400 })
      }
    }

    // Check goalie-only eligibility
    const goalieOnlyCategory = category.categories as unknown as { is_goalie_only: boolean } | null
    if (goalieOnlyCategory?.is_goalie_only) {
      const { data: userProfile } = await supabase
        .from('users')
        .select('is_goalie')
        .eq('id', user.id)
        .single()

      const goalieValidation = RegistrationValidationService.validateGoalieRequirement(
        true,
        !!userProfile?.is_goalie
      )

      if (!goalieValidation.eligible) {
        return NextResponse.json({
          error: goalieValidation.error || 'This category is only open to registered goalies'
        }, { status: 400 })
      }
    }

    // Check if category has capacity limits (null/undefined = unlimited; 0 = waitlist-only)
    if (category.max_capacity === null || category.max_capacity === undefined) {
      return NextResponse.json({
        error: 'This category does not have capacity limits and does not require a waitlist'
      }, { status: 400 })
    }

    // Check current registration count for this category
    const { count: currentCount, error: countError } = await supabase
      .from('user_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('registration_category_id', categoryId)
      .eq('payment_status', 'paid')

    if (countError) {
      logger.logPaymentProcessing('waitlist-capacity-check-failed', 'Error checking category capacity', { userId: user.id, registrationId, categoryId, error: countError.message }, 'error')
      return NextResponse.json({ error: 'Failed to check category capacity' }, { status: 500 })
    }

    // Verify category is actually at capacity (currentCount < max_capacity means space remains)
    if (currentCount !== null && currentCount < category.max_capacity) {
      return NextResponse.json({
        error: 'This category is not at capacity. You can register normally.'
      }, { status: 400 })
    }

    // Check if user is already registered for this registration (with paid status)
    const { data: existingRegistration } = await supabase
      .from('user_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('payment_status', 'paid')
      .single()

    if (existingRegistration) {
      return NextResponse.json({ 
        error: 'You are already registered for this event' 
      }, { status: 400 })
    }

    // Check if user is already on waitlist for this category
    // Note: Check regardless of removed_at status due to unique constraint
    const { data: existingWaitlist } = await supabase
      .from('waitlists')
      .select('id, position, removed_at')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('registration_category_id', categoryId)
      .maybeSingle()

    if (existingWaitlist && existingWaitlist.removed_at === null) {
      // Already on active waitlist
      return NextResponse.json({
        error: `You are already on the waitlist for this category`
      }, { status: 400 })
    }

    let waitlistEntry: WaitlistRow | undefined
    let nextPosition: number

    if (existingWaitlist) {
      // Previously removed from waitlist - update the existing record instead of inserting
      nextPosition = await getNextPosition(supabase, registrationId, categoryId)

      const { data: reactivatedEntry, error: reactivateError } = await supabase
        .from('waitlists')
        .update({
          removed_at: null,
          position: nextPosition,
          discount_code_id: validatedDiscountCodeId,
          joined_at: new Date().toISOString()
        })
        .eq('id', existingWaitlist.id)
        .select()
        .single()

      if (reactivateError) {
        logger.logPaymentProcessing('waitlist-reactivate-failed', 'Error reactivating waitlist entry', { userId: user.id, registrationId, categoryId, waitlistId: existingWaitlist.id, error: reactivateError.message }, 'error')
        return NextResponse.json({ error: 'Failed to rejoin waitlist' }, { status: 500 })
      }

      waitlistEntry = reactivatedEntry
    } else {
      // Get the next position in line for this category
      nextPosition = await getNextPosition(supabase, registrationId, categoryId)

      // Add user to waitlist
      const waitlistData = {
        user_id: user.id,
        registration_id: registrationId,
        registration_category_id: categoryId,
        position: nextPosition,
        discount_code_id: validatedDiscountCodeId
      }

      logger.logPaymentProcessing('waitlist-insert-attempt', 'Attempting to insert waitlist entry', { waitlistData }, 'debug')

      const { data: newEntry, error: waitlistError } = await supabase
        .from('waitlists')
        .insert(waitlistData)
        .select()
        .single()

      if (waitlistError) {
        // Reported to Sentry below via captureException; logged here at warn to
        // avoid a duplicate Sentry error report for the same failure.
        logger.logPaymentProcessing('waitlist-insert-failed', 'Error adding to waitlist', { waitlistData, error: waitlistError.message }, 'warn')
        Sentry.captureException(waitlistError, {
          tags: {
            operation: 'waitlist_join',
            user_id: user.id,
            registration_id: registrationId,
            category_id: categoryId
          },
          extra: {
            waitlistData,
            errorDetails: waitlistError
          }
        })
        scheduleSentryFlush()
        return NextResponse.json({
          error: 'Failed to join waitlist',
          details: process.env.NODE_ENV === 'development' ? waitlistError.message : undefined
        }, { status: 500 })
      }

      waitlistEntry = newEntry
    }

    // Get registration and user details for email
    const { data: registration, error: registrationError } = await supabase
      .from('registrations')
      .select(`
        name,
        seasons:season_id (
          name,
          start_date,
          end_date
        )
      `)
      .eq('id', registrationId)
      .single()

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .single()

    if (!registrationError && !userError && registration && userData) {
      // Get category display name
      let categoryDisplayName = category.custom_name || 'Unknown Category'
      if (category.category_id) {
        const { data: masterCategory } = await supabase
          .from('categories')
          .select('name')
          .eq('id', category.category_id)
          .single()
        if (masterCategory) {
          categoryDisplayName = masterCategory.name
        }
      }

      // Send waitlist notification email
      try {
        // The `seasons` relation is a single joined object at runtime; the untyped
        // client can't infer relation cardinality and types it as an array.
        const season = registration.seasons as unknown as { name: string; start_date: string; end_date: string } | null
        const seasonName = season
          ? `${season.name} (${formatDate(new Date(season.start_date))} - ${formatDate(new Date(season.end_date))})`
          : 'Unknown Season'

        await emailService.sendWaitlistAddedNotification({
          userId: user.id,
          email: userData.email,
          userName: `${userData.first_name} ${userData.last_name}`,
          registrationName: registration.name,
          categoryName: categoryDisplayName,
          seasonName: seasonName,
          position: nextPosition
        })
      } catch (emailError) {
        // Log email error but don't fail the waitlist join. Reported to Sentry
        // below via captureException, so logged here at warn to avoid a
        // duplicate Sentry error report.
        logger.logPaymentProcessing('waitlist-email-failed', 'Failed to send waitlist email', { userId: user.id, registrationId, categoryId, error: emailError instanceof Error ? emailError.message : String(emailError) }, 'warn')
        Sentry.captureException(emailError, {
          tags: {
            operation: 'waitlist_email_failed',
            user_id: user.id,
            registration_id: registrationId,
            category_id: categoryId
          }
        })
        scheduleSentryFlush()
      }
    }

    // Log successful waitlist join
    Sentry.addBreadcrumb({
      message: 'User successfully joined waitlist',
      data: {
        user_id: user.id,
        registration_id: registrationId,
        category_id: categoryId,
        position: nextPosition
      }
    })

    return NextResponse.json({
      success: true,
      position: nextPosition,
      waitlistId: waitlistEntry!.id,
      message: `You've been added to the waitlist. You're #${nextPosition} in line.`
    })
    
  } catch (error) {
    // Reported to Sentry below via captureException; logged here at warn to
    // avoid a duplicate Sentry error report for the same failure.
    logger.logPaymentProcessing('waitlist-join-error', 'Error joining waitlist', { error: error instanceof Error ? error.message : String(error) }, 'warn')

    Sentry.captureException(error, {
      tags: {
        operation: 'waitlist_join_error'
      }
    })
    scheduleSentryFlush()

    return NextResponse.json(
      { error: 'Failed to join waitlist' },
      { status: 500 }
    )
  }
}