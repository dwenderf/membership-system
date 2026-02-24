import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

/**
 * Check if a user has a valid saved payment method
 * Payment methods can be saved via setup intent OR via payment intent with setup_future_usage
 */
export async function getUserSavedPaymentMethodId(
  userId: string,
  supabase: any
): Promise<string | null> {
  const { data: userProfile } = await supabase
    .from('users')
    .select('stripe_payment_method_id, setup_intent_status')
    .eq('id', userId)
    .single()

  if (!userProfile?.stripe_payment_method_id) {
    return null
  }

  return userProfile.stripe_payment_method_id
}

/**
 * Save payment method from a completed payment intent to user profile
 * This is called after successful payment when user opted to save their payment method
 */
export async function savePaymentMethodFromIntent(
  paymentIntent: Stripe.PaymentIntent,
  userId: string,
  supabase: any
): Promise<void> {
  if (!paymentIntent.payment_method || !paymentIntent.setup_future_usage) {
    return
  }

  try {
    console.log('💳 Saving payment method for future use:', paymentIntent.payment_method)
    const adminSupabase = createAdminClient()

    // Get user profile to check for Stripe customer ID
    const { data: userProfile } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single()

    let customerId = userProfile?.stripe_customer_id

    // If no customer ID exists, retrieve it from the payment intent or create one
    if (!customerId && paymentIntent.customer) {
      customerId = paymentIntent.customer as string

      // Update user with customer ID
      await adminSupabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)
    }

    if (customerId) {
      // Attach payment method to customer if not already attached
      const paymentMethod = await stripe.paymentMethods.retrieve(
        paymentIntent.payment_method as string
      )

      if (paymentMethod.customer !== customerId) {
        await stripe.paymentMethods.attach(
          paymentIntent.payment_method as string,
          { customer: customerId }
        )
      }

      // Save payment method ID to user profile.
      // Also mark setup_intent_status as 'succeeded' so this record is consistent
      // with the SetupIntent flow, and clear stripe_setup_intent_id since the PM
      // was captured via a PaymentIntent (not a SetupIntent).
      await adminSupabase
        .from('users')
        .update({
          stripe_payment_method_id: paymentIntent.payment_method as string,
          stripe_setup_intent_id: null,
          setup_intent_status: 'succeeded',
          payment_method_updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      logger.logPaymentProcessing(
        'payment-method-saved',
        'Successfully saved payment method for user',
        {
          userId,
          paymentIntentId: paymentIntent.id,
          paymentMethodId: paymentIntent.payment_method as string
        },
        'info'
      )

      console.log('✅ Successfully saved payment method for user')
    }
  } catch (pmError) {
    logger.logPaymentProcessing(
      'payment-method-save-error',
      'Error saving payment method',
      {
        userId,
        paymentIntentId: paymentIntent.id,
        error: pmError instanceof Error ? pmError.message : String(pmError)
      },
      'error'
    )
    console.error('Error saving payment method:', pmError)
    // Don't throw - this is a non-critical failure
  }
}
