import { NextRequest, NextResponse } from 'next/server'
import { formatDate } from '@/lib/date-utils'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'


// Force import server config

import * as Sentry from '@sentry/nextjs'

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
    const { registrationId, categoryId, discountCodeId } = body

    // Validate required fields
    if (!registrationId || !categoryId) {
      return NextResponse.json(
        { error: 'Missing required fields: registrationId, categoryId' },
        { status: 400 }
      )
    }

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
        registration_id
      `)
      .eq('id', categoryId)
      .single()

    if (categoryError || !category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Check if category has capacity limits
    if (!category.max_capacity) {
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
      console.error('Error checking category capacity:', countError)
      return NextResponse.json({ error: 'Failed to check category capacity' }, { status: 500 })
    }

    // Verify category is actually at capacity
    if (!currentCount || currentCount < category.max_capacity) {
      return NextResponse.json({ 
        error: 'This category is not at capacity. You can register normally.' 
      }, { status: 400 })
    }

    // Check if user is already registered for this registration
    const { data: existingRegistration } = await supabase
      .from('user_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .single()

    if (existingRegistration) {
      return NextResponse.json({ 
        error: 'You are already registered for this event' 
      }, { status: 400 })
    }

    // Check if user is already on waitlist for this category
    const { data: existingWaitlist } = await supabase
      .from('waitlists')
      .select('id, position')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('registration_category_id', categoryId)
      .is('removed_at', null)
      .single()

    if (existingWaitlist) {
      return NextResponse.json({ 
        error: `You are already on the waitlist for this category` 
      }, { status: 400 })
    }

    // Get the next position in line for this category
    const { data: maxPosition } = await supabase
      .from('waitlists')
      .select('position')
      .eq('registration_id', registrationId)
      .eq('registration_category_id', categoryId)
      .is('removed_at', null)
      .order('position', { ascending: false })
      .limit(1)
      .single()

    const nextPosition = maxPosition ? maxPosition.position + 1 : 1

    // Add user to waitlist
    const { data: waitlistEntry, error: waitlistError } = await supabase
      .from('waitlists')
      .insert({
        user_id: user.id,
        registration_id: registrationId,
        registration_category_id: categoryId,
        position: nextPosition,
        discount_code_id: validatedDiscountCodeId
      })
      .select()
      .single()

    if (waitlistError) {
      console.error('Error adding to waitlist:', waitlistError)
      Sentry.captureException(waitlistError, {
        tags: {
          operation: 'waitlist_join',
          user_id: user.id,
          registration_id: registrationId,
          category_id: categoryId
        }
      })
      return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 })
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
        const season = registration.seasons as any  // Supabase types this as array but it's a single object
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
        // Log email error but don't fail the waitlist join
        console.error('Failed to send waitlist email:', emailError)
        Sentry.captureException(emailError, {
          tags: {
            operation: 'waitlist_email_failed',
            user_id: user.id,
            registration_id: registrationId,
            category_id: categoryId
          }
        })
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
      waitlistId: waitlistEntry.id,
      message: `You've been added to the waitlist. You're #${nextPosition} in line.`
    })
    
  } catch (error) {
    console.error('Error joining waitlist:', error)
    
    Sentry.captureException(error, {
      tags: {
        operation: 'waitlist_join_error'
      }
    })
    
    return NextResponse.json(
      { error: 'Failed to join waitlist' },
      { status: 500 }
    )
  }
}