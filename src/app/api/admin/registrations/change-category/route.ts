import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

interface ChangeCategoryRequest {
  userRegistrationId: string
  newCategoryId: string
  reason: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    // Check admin authorization
    const { data: { user: authUser } } = await supabase.auth.getUser()
    
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request
    const body: ChangeCategoryRequest = await request.json()
    const { userRegistrationId, newCategoryId, reason } = body

    if (!userRegistrationId || !newCategoryId || !reason?.trim()) {
      return NextResponse.json({ 
        error: 'User registration ID, new category ID, and reason are required' 
      }, { status: 400 })
    }

    // Get current registration
    const { data: registration, error: regError } = await supabase
      .from('user_registrations')
      .select(\`
        *,
        users!inner (
          id,
          first_name,
          last_name,
          email,
          stripe_payment_method_id,
          stripe_customer_id
        ),
        registration_categories!inner (
          id,
          price,
          custom_name,
          categories (
            name
          )
        ),
        registrations!inner (
          id,
          name
        )
      \`)
      .eq('id', userRegistrationId)
      .single()

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (registration.payment_status !== 'paid') {
      return NextResponse.json({ 
        error: \`Cannot change category for registration with status: \${registration.payment_status}\` 
      }, { status: 400 })
    }

    if (registration.registration_category_id === newCategoryId) {
      return NextResponse.json({ 
        error: 'User is already registered in this category' 
      }, { status: 400 })
    }

    // Get new category
    const { data: newCategory, error: catError } = await supabase
      .from('registration_categories')
      .select(\`
        *,
        categories (
          name
        )
      \`)
      .eq('id', newCategoryId)
      .eq('registration_id', registration.registration_id)
      .single()

    if (catError || !newCategory) {
      return NextResponse.json({ error: 'Target category not found' }, { status: 404 })
    }

    // Check capacity
    const { count: currentCount } = await supabase
      .from('user_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('registration_category_id', newCategoryId)
      .or(\`payment_status.eq.paid,payment_status.eq.processing,and(payment_status.eq.awaiting_payment,reservation_expires_at.gt.\${new Date().toISOString()})\`)

    if (newCategory.max_capacity && currentCount !== null && currentCount >= newCategory.max_capacity) {
      return NextResponse.json({ 
        error: \`Target category is at full capacity (\${currentCount}/\${newCategory.max_capacity})\` 
      }, { status: 400 })
    }

    // Calculate price difference
    const oldPrice = registration.amount_paid
    const newPrice = newCategory.price
    const priceDifference = newPrice - oldPrice
    
    const oldCat = Array.isArray(registration.registration_categories) ? registration.registration_categories[0] : registration.registration_categories
    const oldCategory = oldCat?.categories ? (Array.isArray(oldCat.categories) ? oldCat.categories[0] : oldCat.categories) : null
    const oldCategoryName = oldCategory?.name || oldCat?.custom_name || 'Unknown'
    
    const newCat = Array.isArray(newCategory.categories) ? newCategory.categories[0] : newCategory.categories
    const newCategoryName = newCat?.name || newCategory.custom_name || 'Unknown'

    const user = Array.isArray(registration.users) ? registration.users[0] : registration.users

    logger.logSystem('category-change-initiated', 'Processing category change', {
      registrationId: userRegistrationId,
      userId: registration.user_id,
      oldCategory: oldCategoryName,
      newCategory: newCategoryName,
      priceDifference
    })

    if (priceDifference > 0) {
      // NEW PRICE > OLD PRICE: User owes money
      if (!user.stripe_payment_method_id) {
        return NextResponse.json({ 
          error: 'User must have a payment method on file to upgrade category' 
        }, { status: 400 })
      }

      // Create payment intent for difference
      const paymentIntent = await stripe.paymentIntents.create({
        amount: priceDifference,
        currency: 'aud',
        customer: user.stripe_customer_id,
        payment_method: user.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: \`Category change: \${oldCategoryName} → \${newCategoryName}\`,
        metadata: {
          user_id: registration.user_id,
          registration_id: registration.registration_id,
          user_registration_id: userRegistrationId,
          category_change: 'true',
          old_category: oldCategoryName,
          new_category: newCategoryName,
          reason: reason
        }
      })

      if (paymentIntent.status !== 'succeeded') {
        return NextResponse.json({ 
          error: 'Payment for category upgrade failed' 
        }, { status: 400 })
      }

      // Create payment record
      const { data: newPayment } = await supabase
        .from('payments')
        .insert({
          user_id: registration.user_id,
          final_amount: priceDifference,
          stripe_payment_intent_id: paymentIntent.id,
          status: 'completed',
          completed_at: new Date().toISOString(),
          metadata: {
            type: 'category_change_upgrade',
            old_category_id: registration.registration_category_id,
            new_category_id: newCategoryId,
            user_registration_id: userRegistrationId
          }
        })
        .select()
        .single()

      // Update registration
      await supabase
        .from('user_registrations')
        .update({
          registration_category_id: newCategoryId,
          registration_fee: newCategory.price,
          amount_paid: oldPrice + priceDifference,
          payment_id: newPayment?.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', userRegistrationId)

      logger.logSystem('category-change-complete', 'Category upgraded with payment', {
        registrationId: userRegistrationId,
        paymentId: newPayment?.id,
        amountCharged: priceDifference
      })

      return NextResponse.json({
        success: true,
        action: 'charged',
        amount: priceDifference,
        message: \`Category changed successfully. User charged $\${(priceDifference / 100).toFixed(2)}.\`
      })

    } else if (priceDifference < 0) {
      // OLD PRICE > NEW PRICE: User gets refund
      const refundAmount = Math.abs(priceDifference)

      if (!registration.payment_id) {
        return NextResponse.json({ 
          error: 'Original payment not found for refund processing' 
        }, { status: 404 })
      }

      const { data: originalPayment } = await supabase
        .from('payments')
        .select('stripe_payment_intent_id')
        .eq('id', registration.payment_id)
        .single()

      if (!originalPayment?.stripe_payment_intent_id) {
        return NextResponse.json({ 
          error: 'Cannot process refund - original payment has no Stripe payment intent' 
        }, { status: 400 })
      }

      // Create refund record
      const { data: refund } = await supabase
        .from('refunds')
        .insert({
          payment_id: registration.payment_id,
          user_id: registration.user_id,
          amount: refundAmount,
          reason: \`Category change: \${oldCategoryName} → \${newCategoryName}. \${reason}\`,
          status: 'pending',
          processed_by: authUser.id,
        })
        .select()
        .single()

      if (!refund) {
        return NextResponse.json({ error: 'Failed to create refund record' }, { status: 500 })
      }

      // Process Stripe refund
      try {
        await supabase
          .from('refunds')
          .update({ status: 'processing' })
          .eq('id', refund.id)

        const stripeRefund = await stripe.refunds.create({
          payment_intent: originalPayment.stripe_payment_intent_id,
          amount: refundAmount,
          reason: 'requested_by_customer',
          metadata: {
            refund_id: refund.id,
            processed_by: authUser.id,
            category_change: 'true'
          }
        })

        await supabase
          .from('refunds')
          .update({
            stripe_refund_id: stripeRefund.id,
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', refund.id)

        // Update registration (don't change payment_status to 'refunded' - user is still registered)
        await supabase
          .from('user_registrations')
          .update({
            registration_category_id: newCategoryId,
            registration_fee: newCategory.price,
            amount_paid: newPrice,
            updated_at: new Date().toISOString()
          })
          .eq('id', userRegistrationId)

        logger.logSystem('category-change-complete', 'Category downgraded with refund', {
          registrationId: userRegistrationId,
          refundId: refund.id,
          amountRefunded: refundAmount
        })

        return NextResponse.json({
          success: true,
          action: 'refunded',
          amount: refundAmount,
          message: \`Category changed successfully. User refunded $\${(refundAmount / 100).toFixed(2)}.\`
        })

      } catch (stripeError) {
        await supabase
          .from('refunds')
          .update({
            status: 'failed',
            failure_reason: stripeError instanceof Error ? stripeError.message : 'Unknown error',
          })
          .eq('id', refund.id)

        return NextResponse.json({ 
          error: 'Refund processing failed' 
        }, { status: 500 })
      }

    } else {
      // PRICES EQUAL: Just update category
      await supabase
        .from('user_registrations')
        .update({
          registration_category_id: newCategoryId,
          updated_at: new Date().toISOString()
        })
        .eq('id', userRegistrationId)

      logger.logSystem('category-change-complete', 'Category changed (no price difference)', {
        registrationId: userRegistrationId
      })

      return NextResponse.json({
        success: true,
        action: 'updated',
        amount: 0,
        message: 'Category changed successfully (no price difference).'
      })
    }

  } catch (error) {
    logger.logSystem('category-change-error', 'Unexpected error', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
